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

/**
 * 마지막 **top-level** balanced object. (여러 객체를 연달아 낸 응답에서 마지막이 최종답이라는 관례.)
 *
 * #105: 매칭에 성공하면 그 객체 **뒤로 점프**한다 — 예전 구현은 모든 `{` 를 훑어 중첩 객체까지
 * 후보로 삼는 바람에 `{"answers":[…,{"id":"X"}]}` 에서 안쪽 `{"id":"X"}` 를 돌려줬다.
 * 기존 호출부(vision·structured_action·judge 응답)는 전부 flat 이라 드러나지 않았지만,
 * 중첩 스키마를 쓰는 agent 시나리오(docs/grounding)에서는 정통으로 깨진다.
 */
function lastBalancedObject(text: string): string | null {
  let last: string | null = null;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    const obj = scanBalanced(text, i);
    if (obj) {
      last = obj;
      i += obj.length; // 중첩 진입 금지 — 매칭된 객체 전체를 건너뛴다.
    } else {
      i += 1; // 미완성 `{` — 다음 후보로.
    }
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
