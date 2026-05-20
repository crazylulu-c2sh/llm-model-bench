# Agent notes

- **Reasoning vs. user-facing language:** Think and reason in English; communicate with the user in Korean unless they explicitly ask for another language.
- UI follows root `DESIGN.md` (GitHub Primer–inspired light/dark tokens). Prefer CSS variables already defined in `apps/web/src/index.css` over ad-hoc colors.
- Non-functional requirements (NFR) adopted for v1: API keys via env, session UI (`sessionStorage` by default), or **opt-in** plaintext `localStorage` only after explicit user consent with in-UI risk disclosure; reproducibility fields in bench payloads/results; default serial execution with explicit warning for parallel; partial results + `error` stream events on failure; Vitest HTTP mocks for server provider clients.
- Do not commit real API keys or customer base URLs in fixtures or logs.
- **Vision benchmark (v1):** 10 비전 시나리오(`vision_*_a` / `_b`)는 opt-in 입니다.
  - 자산: `apps/web/public/vision/*.webp` (원본은 `docs/vision_bench/`). 갱신 시 `pnpm prepare:vision` 실행.
  - 이미지 전달: loopback/사설망 origin은 자동 base64 인라인, 공개 origin은 URL. 분기는 `apps/server/src/vision-assets.ts` 단일 모듈이 담당.
  - 채점: 0~3 루브릭 → `score: 0|0.33|0.67|1`, pass는 `score >= 0.67`. `packages/shared/src/scenarios-preview.ts#rubricToScore` 단일 호출 지점.
  - LLM-as-Judge: `LLM_JUDGE_ENABLED=1` + `ANTHROPIC_API_KEY` 설정 시에만 meme/wireframe 시나리오의 judge가 호출됨. 비활성 시 prefilter 통과 + rubric 1(pass: false)로 기록.
  - 클라이언트는 `POST /api/bench/stream` body에 `scenarioIds: string[]`를 명시적으로 전달. 미전송 시 서버는 `DEFAULT_SCENARIO_IDS`(텍스트 8개)만 실행.
