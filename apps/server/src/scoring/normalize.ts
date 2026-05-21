import { stripThinkingBlocks } from "@llm-bench/shared";

/** 응답에서 첫 JSON 객체를 추출 — fenced ```json/```일반 블록 우선, 없으면 마지막 / 첫 객체. */
export function extractFirstJsonObject(raw: string): string | null {
  if (!raw) return null;
  const stripped = stripThinkingBlocks(raw);

  // 1) fenced ```json``` / ``` 블록 우선
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  const fenced: string[] = [];
  while ((m = fenceRe.exec(stripped))) fenced.push(m[1]);
  for (const block of fenced) {
    const obj = balancedObject(block);
    if (obj) return obj;
  }

  // 2) 마지막 `{...}` 시도 (마지막 finalized object이 보통 정답)
  const last = lastBalancedObject(stripped);
  if (last) return last;

  // 3) 첫 `{...}`
  return firstBalancedObject(stripped);
}

function balancedObject(text: string): string | null {
  return firstBalancedObject(text);
}

function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  return scanBalanced(text, start);
}

function lastBalancedObject(text: string): string | null {
  const start = text.lastIndexOf("{");
  if (start < 0) return null;
  // start부터 보다는 끝에서 가장 가까운 balanced object를 찾기 위해
  // 먼저 첫번째 balanced를 찾고, 마지막으로 갱신.
  let last: string | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const obj = scanBalanced(text, i);
    if (obj) last = obj;
  }
  return last;
}

function scanBalanced(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** `Q2 2024` / `Q2'24` / `2024 Q2` / `Q2-2024` → `Q2 2024`. */
export function normalizeQuarter(s: string | undefined | null): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toUpperCase().replace(/\s+/g, " ");
  const m1 = t.match(/^Q([1-4])[\s\-'/]*((?:20)?\d{2})$/);
  if (m1) return `Q${m1[1]} ${expandYear(m1[2])}`;
  const m2 = t.match(/^((?:20)?\d{2})[\s\-'/]*Q([1-4])$/);
  if (m2) return `Q${m2[2]} ${expandYear(m2[1])}`;
  return null;
}

function expandYear(yy: string): string {
  if (yy.length === 4) return yy;
  return `20${yy.padStart(2, "0")}`;
}

/** `c` → `C`, ` C ` → `C`. */
export function normalizeProduct(s: string | undefined | null): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toUpperCase();
  return t.length === 1 && /[A-Z]/.test(t) ? t : t || null;
}

/** `+20.7%` / `20.7` / `-12.3%` / `$2,373.9` → number. 부호 보존. */
export function parseSignedPercent(input: string | number | null | undefined): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return null;
  const cleaned = input
    .trim()
    .replace(/^[+\s]*/, (s) => (s.includes("-") ? "-" : ""))
    .replace(/[\s$%,]/g, "");
  // `$2,373.9` → `2373.9`, `+20.7%` → `20.7`, `-12.3%` → `-12.3`
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
