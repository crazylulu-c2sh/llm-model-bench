import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

const WHITELIST_PATH = "/nist.fips.197.pdf";
const MAX_URL_TEXT = 8_000;
const MAX_PDF_CHARS = 6_000;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;

function repoRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/** UI에서 넘긴 origin 또는 scripts/dev-ports.json 의 vitePort 폴백 */
export function resolvePublicAssetsOrigin(input: { publicAssetsOrigin?: string | null }): string {
  if (input.publicAssetsOrigin) {
    try {
      const u = new URL(input.publicAssetsOrigin);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  try {
    const devPortsPath = path.join(repoRootDir(), "scripts/dev-ports.json");
    const raw = readFileSync(devPortsPath, "utf8");
    const vitePort = (JSON.parse(raw) as { vitePort?: number }).vitePort ?? 5173;
    return `http://127.0.0.1:${vitePort}`;
  } catch {
    return "http://127.0.0.1:5173";
  }
}

export function nistFips197PdfUrl(publicAssetsOrigin: string): string {
  const base = publicAssetsOrigin.replace(/\/+$/, "");
  return `${base}${WHITELIST_PATH}`;
}

/** SSRF 방지: `publicAssetsOrigin` 과 동일한 origin 이며 `/nist.fips.197.pdf` 만 허용 */
export function assertUrlAllowed(publicAssetsOrigin: string, urlStr: string): void {
  const base = new URL(`${publicAssetsOrigin.replace(/\/+$/, "")}/`);
  const u = new URL(urlStr);
  if (u.origin !== base.origin) throw new Error("url origin not allowed");
  if (u.pathname !== WHITELIST_PATH) throw new Error("url path not allowed");
}

export async function executeBenchTool(
  name: string,
  argsJson: string,
  fetchImpl: typeof fetch,
  publicAssetsOrigin: string,
): Promise<string> {
  let args: { url?: string };
  try {
    args = JSON.parse(argsJson || "{}") as { url?: string };
  } catch {
    return "error: invalid tool arguments JSON";
  }
  if (typeof args.url !== "string" || !args.url.trim()) {
    return "error: missing url";
  }
  try {
    assertUrlAllowed(publicAssetsOrigin, args.url.trim());
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  const r = await fetchImpl(args.url.trim(), {
    redirect: "error",
    headers: { Accept: "*/*" },
  });
  if (!r.ok) {
    return `error: HTTP ${r.status}`;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    return "error: response too large";
  }

  if (name === "fetch_pdf_text") {
    const parser = new PDFParse({ data: buf });
    try {
      const data = await parser.getText();
      const t = (data.text ?? "").trim();
      return t.length ? t.slice(0, MAX_PDF_CHARS) : "error: empty pdf text";
    } finally {
      await parser.destroy();
    }
  }
  if (name === "fetch_url") {
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("application/pdf")) {
      return "error: binary PDF — call fetch_pdf_text with the same url instead";
    }
    return buf.toString("utf8").slice(0, MAX_URL_TEXT);
  }
  return `error: unknown tool ${name}`;
}
