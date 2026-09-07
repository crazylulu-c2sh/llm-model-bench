"use strict";
/**
 * LAN 송신 프록시 (폴백) — macOS 로컬 네트워크 차단 우회용.
 *
 * macOS는 로그인 세션이 죽은 프로세스의 LAN 접근을 막는다(루프백은 대상 아님).
 * pm2 데몬 아래의 서버가 여기에 걸리므로, 컨테이너(Linux VM, 정책 미적용) 안의
 * 이 프록시를 루프백으로 경유해 LAN에 나간다.
 *
 * 공유 프록시(127.0.0.1:3128)와 **동일한 상대 경로 규약**을 구현한다 — 드롭인 대체가
 * 되어야 ecosystem.config.cjs의 선택 로직이 한 가지 형태만 알면 된다.
 *   GET /healthz  → 200, 본문 정확히 "ok"
 *   GET /__health → 200, JSON {ok, served, failed, tunnels, idleMs}
 *   그 외 상대 경로 → 400 "absolute URI required"
 * 실제 프록시 트래픽은 항상 absolute-URI 또는 CONNECT라 상대 경로와 충돌하지 않는다.
 */
const http = require("node:http");
const net = require("node:net");

const PORT = Number(process.env.PORT || 3129);

/**
 * 유휴(idle) 타임아웃 — 수명 상한이 아니라 **무응답 구간**만 자른다.
 * 반드시 이 호스트의 가장 긴 소비자 타임아웃보다 커야 한다: 서버의
 * bench-runner.ts MAX_REQUEST_TIMEOUT_MS = 3_600_000(1시간). 그보다 작으면
 * "요청이 너무 느리다"를 프록시가 판단하게 되고, 소비자가 기대한 오류 대신
 * UND_ERR_SOCKET이 올라간다. 첫 바이트 전 대기도 유휴로 세어지므로
 * JIT 모델 로드·긴 prefill이 여기에 걸린다.
 * 소비자 타임아웃을 올릴 땐 이 값도 함께 올릴 것.
 */
const IDLE_MS = Number(process.env.PROXY_IDLE_MS || 3_900_000);

const stats = { served: 0, failed: 0, tunnels: 0 };

/** 한 줄 JSON — `docker logs`로 바로 읽힌다. 프록시 장애는 조용하면 안 된다. */
const log = (ev, extra) => {
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), ev, ...extra }) + "\n");
};

/**
 * hop-by-hop 헤더 제거(RFC 7230 §6.1) — 요청·응답 양방향.
 * Node 소비자는 CONNECT 터널을 쓰므로 이 경로를 타지 않지만(불투명 TCP 파이프),
 * curl --proxy 같은 absolute-URI 소비자를 위해 유지한다.
 */
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
]);
function stripHopByHop(headers) {
  const out = {};
  const listed = new Set(
    String(headers.connection || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk) || listed.has(lk)) continue;
    out[k] = v;
  }
  return out;
}

const server = http.createServer((req, res) => {
  // 상대 경로 = 프록시 트래픽이 아니다. 헬스 엔드포인트로만 쓴다.
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end("ok");
  }
  if (req.url === "/__health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, ...stats, idleMs: IDLE_MS }));
  }

  let target;
  try {
    target = new URL(req.url);
    if (target.protocol !== "http:") throw new Error("unsupported scheme");
  } catch {
    log("bad-url", { url: req.url });
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    return res.end("absolute URI required");
  }

  const upstream = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...stripHopByHop(req.headers), host: target.host },
    },
    (upRes) => {
      stats.served += 1;
      res.writeHead(upRes.statusCode, stripHopByHop(upRes.headers));
      upRes.pipe(res);
    },
  );

  // 유휴 기준 — 데이터가 흐르는 한 만료되지 않는다.
  upstream.setTimeout(IDLE_MS, () => {
    log("request-timeout", { host: target.hostname, port: target.port || 80, why: "idle" });
    upstream.destroy(new Error("idle timeout"));
  });
  upstream.on("error", (err) => {
    stats.failed += 1;
    log("request-end", { host: target.hostname, port: target.port || 80, why: "upstream", code: err.code || err.message });
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("upstream: " + (err.code || err.message));
  });
  // 클라이언트가 떠나면 업스트림을 정리한다 — 중간 취소로 소켓이 새면 안 된다.
  res.on("close", () => upstream.destroy());

  req.pipe(upstream);
});

/**
 * CONNECT 터널 — Node의 --use-env-proxy가 쓰는 유일한 경로다.
 * 평문 http:// 대상도 여기로 온다. raw 양방향 pipe를 유지해야
 * 스트리밍 증분 도착과 중간 취소 정리가 보존된다.
 */
server.on("connect", (req, clientSock, head) => {
  const [host, portRaw] = req.url.split(":");
  const port = Number(portRaw) || 443;
  const upstream = net.connect(port, host, () => {
    stats.tunnels += 1;
    clientSock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSock);
    clientSock.pipe(upstream);
  });

  let done = false;
  const end = (why, code) => {
    if (done) return;
    done = true;
    if (why) log("tunnel-end", { host, port, why, ...(code ? { code } : {}) });
    upstream.destroy();
    clientSock.destroy();
  };

  for (const [sock, side] of [[upstream, "upstream"], [clientSock, "client"]]) {
    sock.setTimeout(IDLE_MS, () => end(side + "-idle"));
    sock.on("error", (err) => {
      if (side === "upstream") stats.failed += 1;
      end(side, err.code || err.message);
    });
    sock.on("close", () => end(null));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log("listening", { port: PORT, idleMs: IDLE_MS });
});
