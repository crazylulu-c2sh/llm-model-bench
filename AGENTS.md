# Agent notes

- **Reasoning vs. user-facing language:** Think and reason in English; communicate with the user in Korean unless they explicitly ask for another language.
- UI follows root `DESIGN.md` (GitHub Primer–inspired light/dark tokens). Prefer CSS variables already defined in `apps/web/src/index.css` over ad-hoc colors.
- Non-functional requirements (NFR) adopted for v1: API keys via env, session UI (`sessionStorage` by default), or **opt-in** plaintext `localStorage` only after explicit user consent with in-UI risk disclosure; reproducibility fields in bench payloads/results; default serial execution with explicit warning for parallel; partial results + `error` stream events on failure; Vitest HTTP mocks for server provider clients.
- Do not commit real API keys or customer base URLs in fixtures or logs.
