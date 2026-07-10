import type { Context, Hono } from "hono";
import { z } from "zod";
import type {
  LmsAvailability,
  MonitorSnapshotResponse,
  ProviderKind,
} from "@llm-bench/shared";
import { ProviderKindSchema } from "@llm-bench/shared";
import {
  isLmsCliEnabled,
  isValidModelId,
  lmsCheckAvailable,
  lmsLoad,
  lmsUnload,
  spawnLmsLogStream,
} from "./lms-cli.js";
import { lmStudioListModels, lmStudioLoad, lmStudioUnload } from "./lmstudio.js";
import { hasValidBenchApiKey } from "./middleware/api-key-auth.js";
import {
  collectLmStudioLoaded,
  collectOllamaLoaded,
  type ProviderLoadedResult,
} from "./monitor-collect.js";
import { getGpuSnapshot, getSystemSnapshot } from "./system-info.js";
import {
  getClientRemoteAddr,
  isLocalhostBaseUrl,
  isLoopbackRemoteAddr,
} from "./util/localhost.js";

const MonitorSnapshotBody = z.object({
  baseUrl: z.string().min(1),
  provider: ProviderKindSchema,
  apiKey: z.string().optional(),
});

const LmsModelBody = z.object({
  model: z.string().min(1).max(256),
  baseUrl: z.string().min(1),
});

// #82: 원격-안전 네이티브 프록시 바디 — CLI(loopback) 경로의 LmsModelBody와 별개.
// `apiKey`는 URL이 아닌 body로 받아 업스트림 LM Studio 인증 키가 로그·쿼리스트링에 새지 않게 한다.
const LmsNativeListBody = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
});
const LmsNativeModelBody = z.object({
  baseUrl: z.string().min(1),
  model: z.string().min(1).max(256),
  apiKey: z.string().optional(),
});

/**
 * #82: 원격 모델 관리(네이티브 프록시) 게이트.
 * - loopback 클라이언트는 항상 허용(로컬 기본).
 * - `STRICT_LOCALHOST=0` 이면 원격도 허용하되 **유효한 `BENCH_API_KEYS` 키 필수**(없으면 401).
 * - 기본(미설정/"1")은 비-loopback을 `403 remote_not_loopback`로 잠금(기존 CLI 게이트와 동일).
 */
function remoteMgmtGate(c: Context): { allow: true } | { allow: false; status: 401 | 403; error: string } {
  if (isLoopbackRemoteAddr(getClientRemoteAddr(c))) return { allow: true };
  if (process.env.STRICT_LOCALHOST === "0") {
    return hasValidBenchApiKey(c)
      ? { allow: true }
      : { allow: false, status: 401, error: "unauthorized" };
  }
  return { allow: false, status: 403, error: "remote_not_loopback" };
}

let activeLogClients = 0;
let cliWarningEmitted = false;

function emitCliWarningOnce(): void {
  if (cliWarningEmitted || !isLmsCliEnabled()) return;
  cliWarningEmitted = true;
  process.stderr.write(
    "[monitor] WARNING: ENABLE_LMS_CLI=1 — `lms` CLI는 요청 클라이언트 IP가 loopback일 때만 실행됩니다.\n" +
      "[monitor] 주의: Vite (`pnpm dev`, host:true)를 LAN에 노출하면 요청이 항상 127.0.0.1로 보여 게이트가 우회됩니다.\n" +
      "[monitor] 운영은 단일 호스트(PM2) 또는 SSH 터널 권장.\n",
  );
}

export function registerMonitorRoutes(app: Hono, prefix = "/api"): void {
  emitCliWarningOnce();

  app.post(`${prefix}/monitor/snapshot`, async (c) => {
    let body: z.infer<typeof MonitorSnapshotBody>;
    try {
      const parsed = MonitorSnapshotBody.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        return c.json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
      }
      body = parsed.data;
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }

    const remote = getClientRemoteAddr(c);
    const remoteLoopback = isLoopbackRemoteAddr(remote);
    const localhost = isLocalhostBaseUrl(body.baseUrl);
    const allowCli = remoteLoopback && isLmsCliEnabled();

    const ts = new Date().toISOString();
    const reasons: string[] = [];
    if (!remoteLoopback) reasons.push("client_not_loopback");
    if (!localhost) reasons.push("baseUrl_not_localhost");

    const includeHost = remoteLoopback && localhost;
    const system = includeHost ? getSystemSnapshot() : null;
    // gpu와 provider HTTP는 서로 독립적이라 병렬화 (snapshot p99 단축).
    const [gpu, providerBlock] = await Promise.all([
      includeHost ? getGpuSnapshot(3000) : Promise.resolve(null),
      collectForProvider(body.provider, body.baseUrl, body.apiKey, allowCli),
    ]);

    const resp: MonitorSnapshotResponse = {
      ts,
      localhost,
      remoteLoopback,
      reason: reasons.length > 0 ? reasons.join(",") : undefined,
      system,
      gpu,
      provider: {
        kind: body.provider,
        baseUrl: body.baseUrl,
        source: providerBlock.source,
        loaded: providerBlock.loaded,
        http: providerBlock.http,
        cli: providerBlock.cli,
      },
    };
    return c.json(resp);
  });

  app.get(`${prefix}/monitor/lms/availability`, async (c) => {
    const remote = getClientRemoteAddr(c);
    const remoteLoopback = isLoopbackRemoteAddr(remote);
    const enabled = isLmsCliEnabled();
    if (!remoteLoopback || !enabled) {
      const r: LmsAvailability = { enabled, remoteLoopback, binary: null };
      return c.json(r);
    }
    const binary = await lmsCheckAvailable();
    const r: LmsAvailability = { enabled, remoteLoopback, binary };
    return c.json(r);
  });

  app.post(`${prefix}/monitor/lms/load`, async (c) => {
    const remote = getClientRemoteAddr(c);
    if (!isLoopbackRemoteAddr(remote)) {
      return c.json({ error: "remote_not_loopback" }, 403);
    }
    const parsed = LmsModelBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!isLocalhostBaseUrl(parsed.data.baseUrl)) {
      return c.json({ error: "not_localhost" }, 400);
    }
    if (!isLmsCliEnabled()) {
      return c.json({ error: "lms_cli_disabled" }, 403);
    }
    if (!isValidModelId(parsed.data.model)) {
      return c.json({ error: "invalid_model_id" }, 400);
    }
    const r = await lmsLoad(parsed.data.model, 120_000);
    if (!r.ok) {
      return c.json({ ok: false, error: r.error }, 500);
    }
    return c.json({ ok: true, stdout: r.stdout });
  });

  app.post(`${prefix}/monitor/lms/unload`, async (c) => {
    const remote = getClientRemoteAddr(c);
    if (!isLoopbackRemoteAddr(remote)) {
      return c.json({ error: "remote_not_loopback" }, 403);
    }
    const parsed = LmsModelBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!isLocalhostBaseUrl(parsed.data.baseUrl)) {
      return c.json({ error: "not_localhost" }, 400);
    }
    if (!isLmsCliEnabled()) {
      return c.json({ error: "lms_cli_disabled" }, 403);
    }
    if (!isValidModelId(parsed.data.model)) {
      return c.json({ error: "invalid_model_id" }, 400);
    }
    const r = await lmsUnload(parsed.data.model, 15_000);
    if (!r.ok) {
      return c.json({ ok: false, error: r.error }, 500);
    }
    return c.json({ ok: true, stdout: r.stdout });
  });

  // ─── #82: 원격-안전 네이티브 모델 관리 프록시 ────────────────────────────────
  // LM Studio 자체 REST(`/api/v1/models{,/load,/unload}`)로 포워딩(원격 호스트도 서빙).
  // loopback-only `lms` CLI 경로(lms/load·lms/unload)는 그대로 로컬 기본으로 남는다.
  app.post(`${prefix}/monitor/lms/native/list`, async (c) => {
    const gate = remoteMgmtGate(c);
    if (!gate.allow) return c.json({ error: gate.error }, gate.status);
    const parsed = LmsNativeListBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const { baseUrl, apiKey } = parsed.data;
    try {
      const r = await lmStudioListModels(baseUrl, { apiKey, timeoutMs: 10_000 });
      if (!r.ok) return c.json({ ok: false, upstream_status: r.status, error: r.body }, 502);
      return c.json({ ok: true, status: r.status, models: r.models });
    } catch (e) {
      return c.json({ ok: false, error: "lmstudio_unreachable", detail: String(e).slice(0, 500) }, 502);
    }
  });

  app.post(`${prefix}/monitor/lms/native/load`, async (c) => {
    const gate = remoteMgmtGate(c);
    if (!gate.allow) return c.json({ error: gate.error }, gate.status);
    const parsed = LmsNativeModelBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const { baseUrl, model, apiKey } = parsed.data;
    try {
      const r = await lmStudioLoad(baseUrl, model, { apiKey });
      if (!r.ok) return c.json({ ok: false, upstream_status: r.status, error: r.body }, 502);
      return c.json({ ok: true, status: r.status, body: r.body });
    } catch (e) {
      return c.json({ ok: false, error: "lmstudio_unreachable", detail: String(e).slice(0, 500) }, 502);
    }
  });

  app.post(`${prefix}/monitor/lms/native/unload`, async (c) => {
    const gate = remoteMgmtGate(c);
    if (!gate.allow) return c.json({ error: gate.error }, gate.status);
    const parsed = LmsNativeModelBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const { baseUrl, model, apiKey } = parsed.data;
    try {
      // lmStudioUnload는 목록에서 instance_id를 해석해 언로드(구버전 본문 폴백 포함).
      const r = await lmStudioUnload(baseUrl, model, { apiKey });
      if (!r.ok) return c.json({ ok: false, upstream_status: r.status, error: r.body }, 502);
      return c.json({ ok: true, status: r.status, body: r.body });
    } catch (e) {
      return c.json({ ok: false, error: "lmstudio_unreachable", detail: String(e).slice(0, 500) }, 502);
    }
  });

  app.get(`${prefix}/monitor/lms/log-stream`, (c) => {
    const remote = getClientRemoteAddr(c);
    if (!isLoopbackRemoteAddr(remote)) {
      return c.json({ error: "remote_not_loopback" }, 403);
    }
    const baseUrl = c.req.query("baseUrl") ?? "";
    if (!isLocalhostBaseUrl(baseUrl)) {
      return c.json({ error: "not_localhost" }, 400);
    }
    if (!isLmsCliEnabled()) {
      return c.json({ error: "lms_cli_disabled" }, 403);
    }
    // 라우트 핸들러(동기 부분)에서 즉시 lock 예약 — ReadableStream.start()는
    // stream consumer가 구독한 뒤 비동기로 호출되므로 거기서 +1하면 TOCTOU race.
    if (activeLogClients > 0) {
      return c.json({ error: "log_stream_busy" }, 409);
    }
    activeLogClients += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (activeLogClients > 0) activeLogClients -= 1;
    };

    let child: ReturnType<typeof spawnLmsLogStream> | null = null;
    const encoder = new TextEncoder();
    const externalAbort = new AbortController();
    // body를 한 번도 consume하지 않은 채 client가 끊으면 ReadableStream의 cancel()이
    // 호출되지 않으므로 여기서도 release()를 트리거해야 counter leak이 안 남는다.
    // release는 idempotent라 정상 close/error/cancel 경로와 중복 호출돼도 안전.
    c.req.raw.signal.addEventListener(
      "abort",
      () => {
        externalAbort.abort();
        release();
      },
      { once: true },
    );

    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = (obj: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch {
            /* controller closed */
          }
        };
        try {
          child = spawnLmsLogStream();
        } catch (e) {
          push({ type: "error", message: (e as Error).message });
          release();
          controller.close();
          return;
        }
        push({ type: "started", ts: new Date().toISOString() });

        // chunk 경계에서 라인이 잘려도 다음 chunk와 이어붙이도록 carry-over 버퍼 유지.
        const buffers: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
        const handleChunk = (chunk: Buffer, stream: "stdout" | "stderr") => {
          buffers[stream] += chunk.toString("utf-8");
          let idx = buffers[stream].indexOf("\n");
          while (idx !== -1) {
            const line = buffers[stream].slice(0, idx).replace(/\r$/, "");
            buffers[stream] = buffers[stream].slice(idx + 1);
            if (line.trim()) {
              push({ type: "line", stream, ts: new Date().toISOString(), line });
            }
            idx = buffers[stream].indexOf("\n");
          }
        };
        const flushStream = (stream: "stdout" | "stderr") => {
          const remainder = buffers[stream];
          if (remainder.trim()) {
            push({ type: "line", stream, ts: new Date().toISOString(), line: remainder });
          }
          buffers[stream] = "";
        };
        child.stdout?.on("data", (b: Buffer) => handleChunk(b, "stdout"));
        child.stderr?.on("data", (b: Buffer) => handleChunk(b, "stderr"));
        child.on("close", (code) => {
          flushStream("stdout");
          flushStream("stderr");
          push({ type: "closed", code });
          release();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
        child.on("error", (e) => {
          push({ type: "error", message: e.message });
          release();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });

        externalAbort.signal.addEventListener("abort", () => {
          try {
            child?.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        });
        // narrow race: outer abort가 start() 진입 *전*에 발화했다면 위 listener는
        // 이미 aborted인 signal에 등록되어 fire하지 않는다. 즉시 kill + close로 child orphan 방지.
        // release()는 outer abort handler에서 이미 호출됐고 idempotent.
        if (externalAbort.signal.aborted) {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      },
      cancel() {
        externalAbort.abort();
        try {
          child?.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        release();
      },
    });

    return c.newResponse(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
}

async function collectForProvider(
  kind: ProviderKind,
  baseUrl: string,
  apiKey: string | undefined,
  allowCli: boolean,
): Promise<ProviderLoadedResult> {
  if (kind === "lm_studio") {
    return collectLmStudioLoaded(baseUrl, { apiKey, allowCli });
  }
  if (kind === "ollama") {
    return collectOllamaLoaded(baseUrl);
  }
  return { source: "none", loaded: [] };
}
