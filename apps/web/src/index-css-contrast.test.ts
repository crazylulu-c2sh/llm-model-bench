import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * KWCAG 5.4.3(명도 대비) 회귀 가드: index.css의 다크/라이트 토큰 hex를 파싱해
 * WCAG 상대휘도 공식으로 텍스트 4.5:1 / UI 3:1을 단언한다.
 * 토큰 값을 바꾸면 이 테스트가 대비 회귀를 잡는다 — 임계값을 낮추지 말 것.
 */

const css = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

/** 블록 셀렉터 마커 이후 첫 `{...}` 안의 `--이름: #hex` 선언만 추출 */
function extractVars(source: string, marker: string): Record<string, string> {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`셀렉터 블록을 찾지 못함: ${marker}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const m of source.slice(open + 1, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    vars[`--${m[1]}`] = m[2].toLowerCase();
  }
  return vars;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** fg를 α로 bg 위에 합성한 결과색 (틴트 배지 배경 계산용) */
function compositeOver(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg);
  const g = hexToRgb(bg);
  const hex = f.map((c, i) => Math.round(c * alpha + g[i] * (1 - alpha)).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

const THEMES = {
  다크: extractVars(css, 'html[data-theme="dark"]'),
  라이트: extractVars(css, 'html[data-theme="light"]'),
} as const;

const TEXT_TOKENS = [
  "--foreground",
  "--muted",
  "--danger",
  "--accent-2",
  "--warning",
  "--tier-fast",
  "--tier-good",
  "--tier-okay",
  "--tier-slow",
] as const;

const SURFACES = ["--surface", "--surface-2"] as const;

const UI_TOKENS = ["--border-input", "--focus-ring"] as const;

const PODIUM_TOKENS = ["--podium-1", "--podium-2", "--podium-3"] as const;

/** [텍스트 토큰, 틴트 원색 토큰, 알파] — bg-[var(--x)]/15~20 위의 텍스트 조합 */
const TINT_BADGES: ReadonlyArray<readonly [string, string, number]> = [
  ["--accent-2", "--accent", 0.2],
  ["--tier-good", "--tier-good", 0.2],
  ["--danger", "--danger", 0.15],
  ["--muted", "--muted", 0.15],
];

describe("index.css 색 토큰 대비 (KWCAG 5.4.3)", () => {
  for (const [themeName, vars] of Object.entries(THEMES)) {
    describe(`${themeName} 테마`, () => {
      it("필수 토큰이 모두 hex로 파싱된다", () => {
        const required = [...TEXT_TOKENS, ...SURFACES, ...UI_TOKENS, ...PODIUM_TOKENS, "--accent"];
        for (const token of required) {
          expect(vars[token], `${token} 미정의 또는 hex 아님`).toMatch(/^#[0-9a-f]{6}$/);
        }
      });

      it("텍스트 토큰 on --surface/--surface-2 ≥ 4.5", () => {
        for (const fg of TEXT_TOKENS) {
          for (const bg of SURFACES) {
            expect(contrastRatio(vars[fg], vars[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it("UI 토큰(--border-input/--focus-ring) on --surface ≥ 3", () => {
        for (const fg of UI_TOKENS) {
          expect(contrastRatio(vars[fg], vars["--surface"]), `${fg} on --surface`).toBeGreaterThanOrEqual(3);
        }
      });

      it("--podium-1/2/3 on --surface ≥ 4.5", () => {
        for (const fg of PODIUM_TOKENS) {
          expect(contrastRatio(vars[fg], vars["--surface"]), `${fg} on --surface`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("알파 틴트 배지: 텍스트 on 틴트(α 합성) ≥ 4.5", () => {
        for (const [fg, tint, alpha] of TINT_BADGES) {
          const badgeBg = compositeOver(vars[tint], vars["--surface"], alpha);
          expect(
            contrastRatio(vars[fg], badgeBg),
            `${fg} on ${tint} ${Math.round(alpha * 100)}% over --surface`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }
});
