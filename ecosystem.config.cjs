const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/**
 * API + 정적 UI를 한 Node 프로세스에서 제공 (`WEB_DIST_PATH` → 서버가 `dist` 서빙).
 * MCP 서버(http 트랜스포트)는 별도 프로세스로 벤치 API를 프록시한다.
 * 시크릿(BENCH_API_KEYS/BENCH_API_KEY/MCP_HTTP_TOKEN)은 커밋하지 말고 실제 환경에서 주입한다.
 */

// ── macOS LAN 송신 프록시 선택 ───────────────────────────────────────────────
//
// macOS는 로그인 세션이 죽은 프로세스의 LAN 접근을 막는다(루프백은 대상 아님).
// pm2 God Daemon 아래의 이 서버가 정확히 그 상태라, LAN LM Studio 호출이
// EHOSTUNREACH로 실패한다. Docker VM 안은 이 정책이 적용되지 않으므로
// 루프백으로 컨테이너 프록시를 경유해 나간다.
//
// HTTP_PROXY는 **프로세스 기동 시점에만** 읽히므로(런타임 변경은 무시된다)
// 선택은 여기서, pm2가 이 파일을 평가할 때 끝나야 한다. 재선택은
// `pm2 reload ecosystem.config.cjs --update-env` 로만 일어난다.

const SHARED_PROXY_PORT = 3128; // 다른 팀 세션이 소유. 읽기만 한다.
const FALLBACK_PROXY_PORT = 3129; // 이 저장소 소유: docker/lan-proxy/

/**
 * 프록시가 감당해야 할 최소 유휴 한도 = 이 저장소의 가장 긴 요청 타임아웃.
 * 프록시의 유휴 한도가 이보다 짧으면 "요청이 너무 느리다"를 프록시가 판단하게 되어,
 * 소비자가 기대한 타임아웃 대신 UND_ERR_SOCKET이 올라간다. 첫 바이트 전 대기도
 * 유휴로 세어지므로 JIT 모델 로드·긴 prefill이 여기 걸린다.
 * 하드코딩하지 않고 소스에서 읽는다 — 상수가 바뀌면 게이트도 따라가야 한다.
 */
function requiredIdleMs() {
  const src = path.join(__dirname, "apps/server/src/bench-runner.ts");
  try {
    const m = fs.readFileSync(src, "utf8").match(/MAX_REQUEST_TIMEOUT_MS\s*=\s*([0-9_]+)/);
    if (m) return Number(m[1].replace(/_/g, ""));
  } catch {
    /* 배포본에 src가 없을 수 있다 — 아래 기본값으로 진행하고 경고한다. */
  }
  console.warn(
    "[lan-proxy] bench-runner.ts에서 MAX_REQUEST_TIMEOUT_MS를 읽지 못했습니다. " +
      "3600000으로 가정합니다 — 상수가 바뀌었다면 프록시 유휴 한도를 직접 확인하십시오.",
  );
  return 3_600_000;
}

/**
 * `/__health`를 한 번 호출해 {httpCode, idleMs}를 얻는다.
 *
 * 두 가지가 반드시 필요하다:
 *  - try/catch: 프록시가 없으면 curl은 exit 7로 끝나고 execFileSync는 **throw**한다.
 *    프록시 부재는 이 프로브가 탐지하려는 정상 케이스이므로, 예외가 새면
 *    이 파일의 평가가 중단되어 **pm2가 아무 프로세스도 띄우지 못한다.**
 *  - --noproxy '*': curl은 운영자 셸의 http_proxy/ALL_PROXY를 따른다.
 *    그러면 프로브 자체가 다른 프록시로 우회되어 엉뚱한 응답을 본다.
 */
function probeProxy(port) {
  let out;
  try {
    out = execFileSync(
      "/usr/bin/curl",
      [
        "-s", "--noproxy", "*", "-m", "2",
        "-w", "\n%{http_code}",
        `http://127.0.0.1:${port}/__health`,
      ],
      { encoding: "utf8" },
    );
  } catch {
    return null; // 연결 거부·타임아웃 = 프록시 없음
  }
  const nl = out.lastIndexOf("\n");
  if (nl < 0) return null;
  if (out.slice(nl + 1).trim() !== "200") return null;
  try {
    const idleMs = JSON.parse(out.slice(0, nl)).idleMs;
    return typeof idleMs === "number" ? { port, idleMs } : null;
  } catch {
    return null; // 프록시가 아닌 무언가가 그 포트에 있다
  }
}

/**
 * 존재가 아니라 **능력**으로 고른다 — 살아있음(/healthz)만으로는 부족하다.
 *
 * 우회가 필요한 것은 macOS 뿐이다. 로컬 네트워크 프라이버시는 macOS 기능이라
 * Linux/Windows 배포에는 게이트 자체가 없다. 그런 호스트에서는 프로브도 돌리지 않고
 * 경고도 내지 않는다 — 해당 없는 조언은 소음이고, 진짜 경고를 묻히게 만든다.
 */
function selectLanProxy() {
  const explicit = process.env.BENCH_LAN_PROXY;
  if (explicit) {
    // 명시적 비활성화 — 루프백 프로바이더만 쓰는 macOS 호스트의 탈출구.
    if (["off", "none", "0", "false"].includes(explicit.toLowerCase())) return null;
    console.log(`[lan-proxy] BENCH_LAN_PROXY 사용: ${explicit}`);
    return explicit;
  }
  if (process.platform !== "darwin") return null; // 게이트가 없는 플랫폼 — 조용히 통과
  const need = requiredIdleMs();
  const seen = [];
  for (const [port, label] of [[SHARED_PROXY_PORT, "공유"], [FALLBACK_PROXY_PORT, "폴백"]]) {
    const found = probeProxy(port);
    if (!found) {
      seen.push(`${port}(${label}): 응답 없음`);
      continue;
    }
    if (found.idleMs < need) {
      seen.push(`${port}(${label}): idleMs=${found.idleMs} < ${need} 미달`);
      continue;
    }
    console.log(`[lan-proxy] ${label} 프록시 선택: 127.0.0.1:${port} (idleMs=${found.idleMs})`);
    return `http://127.0.0.1:${port}`;
  }
  console.warn(
    "[lan-proxy] 쓸 수 있는 프록시가 없습니다 — " + seen.join(", ") + "\n" +
      "  macOS에서 pm2로 띄우면 LAN(비루프백) 프로바이더 호출이 EHOSTUNREACH로 실패합니다.\n" +
      "  루프백 baseUrl은 영향이 없습니다. 폴백을 띄우려면:\n" +
      "    docker compose --profile lan-proxy up -d lan-proxy-fallback",
  );
  return null;
}

const lanProxy = selectLanProxy();

/**
 * NODE_USE_ENV_PROXY가 없으면 HTTP_PROXY만으로는 **아무 효과가 없다**(Node 24).
 * NO_PROXY에 루프백을 빼면 127.0.0.1 요청이 컨테이너로 들어가고, 컨테이너 안의
 * 127.0.0.1은 컨테이너 자신이라 즉시 ECONNREFUSED가 나는데 undici가 재시도해서
 * 호출자가 자기 타임아웃까지 정지한다. api.anthropic.com은 judge 전용 목적지라
 * 불필요한 홉을 피하려고 제외한다(judge.ts는 전역 fetch를 기본값으로 쓴다).
 */
const proxyEnv = lanProxy
  ? {
      NODE_USE_ENV_PROXY: "1",
      HTTP_PROXY: lanProxy,
      NO_PROXY: "localhost,127.0.0.1,::1,api.anthropic.com",
    }
  : {};

module.exports = {
  apps: [
    {
      name: "llm-bench",
      cwd: path.join(__dirname, "apps/server"),
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 20080,
        BENCH_DB_PATH: path.join(__dirname, "apps/server/data/bench.sqlite"),
        WEB_DIST_PATH: path.join(__dirname, "apps/web/dist"),
        ...proxyEnv,
      },
    },
    {
      name: "llm-bench-mcp",
      cwd: path.join(__dirname, "apps/mcp"),
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_PORT: 20090,
        BENCH_API_URL: "http://127.0.0.1:20080",
        BENCH_API_VERSION: "/api/v1",
        // MCP는 벤치 서버(루프백)만 호출하므로 LAN 프록시가 필요 없다.
        // BENCH_API_KEY / MCP_HTTP_TOKEN / MCP_ALLOWED_ORIGINS 는 실제 환경에서 주입.
      },
    },
  ],
};
