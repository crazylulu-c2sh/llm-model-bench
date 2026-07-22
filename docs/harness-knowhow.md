# 하네스 노하우 · Harness Know-How

이 문서는 로케일별로 분리되어 있습니다. 언어를 선택하세요 / This document is split per locale — pick a language / このドキュメントはロケール別に分割されています。

- 🇰🇷 **한국어(정본/canonical):** [`harness-knowhow.ko.md`](harness-knowhow.ko.md)
- 🇬🇧 **English:** [`harness-knowhow.en.md`](harness-knowhow.en.md)
- 🇯🇵 **日本語:** [`harness-knowhow.ja.md`](harness-knowhow.ja.md)

웹 UI(`/harness` 탭)는 현재 로케일에 맞는 파일을 자동으로 로드합니다.

---

**유지보수 규칙 / Maintenance:** 하네스 API(`apps/server/src/bench-runner.ts`, `openai-stream.ts`, `anthropic-stream.ts`,
`stress-runner.ts`, `agent-loop.ts`, `contention-probe.ts`, `memory-preflight.ts` 등)를 바꾸는 PR은 **세 파일
(`.ko` / `.en` / `.ja`)을 모두 갱신**하세요. 한국어(`.ko`)가 정본이며, EN/JA는 AI 초안에서 출발했습니다.
구조 정합성(절 번호·코드 펜스·각주 키·앵커)은 `apps/web/src/harness-doc-i18n.test.ts`가 게이트합니다.
