# DESIGN.md (GitHub Primer 스타일, 벤치 UI)

이 프로젝트 UI는 **GitHub Primer에 가까운** 라이트·다크 시맨틱 토큰을 사용합니다. 구현은 [`apps/web/src/index.css`](apps/web/src/index.css)의 CSS 변수이며, 컴포넌트는 임의 색보다 토큰을 우선합니다.

## 비주얼 톤

- **분위기**: 정보 밀도는 유지하되, Primer와 유사한 카드·테두리·그림자로 정돈된 개발자 도구 느낌.
- **밀도**: 컨트롤은 `px-3 py-2` 수준, 테이블은 `text-sm` 컴팩트.

## 색상 팔레트 (시맨틱)

다크 기준 예시(라이트는 동일 토큰명, Primer 라이트 근사값).

| Token          | 다크 예시   | 역할                    |
| -------------- | ----------- | ----------------------- |
| `--surface`    | `#0d1117`   | 앱 배경 (canvas)        |
| `--surface-2`  | `#161b22`   | 패널·카드               |
| `--foreground` | `#e6edf3`   | 본문 텍스트             |
| `--muted`      | `#8b949e`   | 보조 라벨               |
| `--accent`     | `#238636`   | Primary 액션 (Git 녹색) |
| `--accent-2`   | `#3fb950`   | 긍정·보조 시리즈        |
| `--danger`     | `#f85149`   | 오류                    |
| `--border`     | `#30363d`   | 테두리                  |

## 타이포그래피

- **UI**: GitHub과 유사한 시스템 산세리프 스택 (`--font-sans`).
- **데이터 / JSON / 로그**: `ui-monospace` 계열 (`--font-mono`).

## 아이콘·차트

- **아이콘**: `lucide-react` (outline, `currentColor` / 시맨틱 변수).
- **차트**: `recharts`. 막대·레이더 색은 `--chart-ttft`, `--chart-tpot`, `--chart-tps`, `--chart-pass`, `--chart-fail` 등 토큰 우선.
- **코드 하이라이트(선택)**: `prism-react-renderer` + `prismjs`는 lazy chunk로만 로드.

## 컴포넌트

- **카드 섹션 제목**: `--foreground` + `font-semibold`, 필요 시 하단 `border`로 본문과 구분; 보조 라벨·테이블 헤더 링크만 `--muted`.
- **폼 주요 라벨**(예: Base URL, API 키): 카드 제목과 동일하게 `--foreground` + `semibold`, 아이콘만 `--muted`.
- **버튼**: Primary는 `accent` 채움 + 가벼운 `shadow-sm`; 보조는 테두리 + `surface`.
- **입력**: `surface` 배경, 얇은 테두리, URL·키는 monospace.
- **테이블**: 헤더 고정, zebra는 v1 필수 아님.
- **확인·피드백**: 벤치 실행은 `ConfirmDialog`로 확인 후 실행; 연결/감지는 즉시 실행. 짧은 결과는 `sonner` 토스트로 보조(상세는 로그 패널).

## 레이아웃

- 최대 콘텐츠 너비 약 `72rem`, 세로 리듬은 `gap-6` 정도.

## Do / Don’t

- **Do** 차트에서 TTFT(블루 톤) vs TPOT(그린 톤) 대비 유지.
- **Don’t** UI에 비밀을 장기 평문 저장하지 않기.

## 에이전트용 한 줄 프롬프트

> `--surface` / `--surface-2` 배경, `--foreground` 텍스트, `--accent` Primary 버튼, URL·로그는 monospace, 컴팩트 테이블로 구성.
