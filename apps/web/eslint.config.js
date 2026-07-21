// 접근성 게이트 전용 lint — jsx-a11y recommended만 적용 (광범위 스타일 룰 금지)
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

export default [
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ...jsxA11y.flatConfigs.recommended.languageOptions,
      parser: tseslint.parser,
    },
    plugins: {
      ...jsxA11y.flatConfigs.recommended.plugins,
      // react-hooks 플러그인 미설치 — 소스의 eslint-disable(react-hooks/*) 주석이 unknown rule 에러가 되지 않게 스텁 등록
      "react-hooks": { rules: { "exhaustive-deps": { create: () => ({}) } } },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // 기본 depth(2)로는 label > input + span > span 구조의 텍스트를 못 찾아 오탐 — 탐색 깊이만 확장
      "jsx-a11y/label-has-associated-control": ["error", { depth: 25 }],
      // 스크롤 코드 블록 <pre>는 키보드 스크롤을 위해 tabIndex가 필요 (axe scrollable-region-focusable). 랜드마크 남발을 피해 role 없이 태그로 허용
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: ["pre"], roles: ["tabpanel"] }],
    },
  },
];
