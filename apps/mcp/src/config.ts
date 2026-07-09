/** MCP 서버 설정 — 전부 env(+ CLI 플래그)에서. */
export interface McpConfig {
  /** 벤치 HTTP API base(버전 접두 제외). */
  benchApiUrl: string;
  /** 버전 접두 — 기본 `/api/v1`(canonical). */
  apiVersion: string;
  /** 벤치 서버 인증 키 → `Authorization: Bearer`. provider apiKey와 별개. */
  benchApiKey?: string;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  /** http 트랜스포트 자체(agent→MCP) 보호용 bearer. */
  httpToken?: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  /** 스트리밍 도구(run_bench/run_stress) 타임아웃(ms). */
  httpTimeoutMs: number;
}

function csv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(v: string | undefined, def: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(argv: string[] = process.argv, env = process.env): McpConfig {
  let transport: "stdio" | "http" = env.MCP_TRANSPORT === "http" ? "http" : "stdio";
  if (argv.includes("--http")) transport = "http";
  if (argv.includes("--stdio")) transport = "stdio";

  const portFlagIdx = argv.indexOf("--port");
  const portFromFlag = portFlagIdx !== -1 ? Number(argv[portFlagIdx + 1]) : NaN;

  const apiVersionRaw = (env.BENCH_API_VERSION ?? "/api/v1").trim();
  const apiVersion = apiVersionRaw.startsWith("/") ? apiVersionRaw : `/${apiVersionRaw}`;

  return {
    benchApiUrl: (env.BENCH_API_URL ?? "http://127.0.0.1:20080").replace(/\/+$/, ""),
    apiVersion: apiVersion.replace(/\/+$/, ""),
    benchApiKey: env.BENCH_API_KEY?.trim() || undefined,
    transport,
    httpHost: env.MCP_HTTP_HOST?.trim() || "127.0.0.1",
    httpPort: Number.isFinite(portFromFlag) ? portFromFlag : num(env.MCP_PORT, 20090),
    httpToken: env.MCP_HTTP_TOKEN?.trim() || undefined,
    allowedHosts: csv(env.MCP_ALLOWED_HOSTS).length ? csv(env.MCP_ALLOWED_HOSTS) : ["127.0.0.1", "localhost"],
    allowedOrigins: csv(env.MCP_ALLOWED_ORIGINS),
    httpTimeoutMs: num(env.BENCH_HTTP_TIMEOUT_MS, 900_000),
  };
}
