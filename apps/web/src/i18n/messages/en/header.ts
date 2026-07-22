import type { Messages } from "../ko";

// header — ko와 키가 정확히 일치해야 함(타입이 강제).
export const header: Messages["header"] = {
  nav: {
    bench: "Model Bench",
    stats: "Model Stats",
    stress: "Provider Bench",
    providerStats: "Provider Stats",
    profile: "Profile",
    monitor: "Provider Monitor",
    scenarios: "Scenarios",
    harness: "Harness",
  },
  subtitle: {
    bench: "Local provider detection · single-model scenario bench",
    stats: "Metrics & results from the latest runs stored in SQLite",
    stress: "Concurrent user load · staged TPS · live worker monitor",
    providerStats: "Provider bench runs in SQLite — filter, export, delete",
    profile: "Per-family sampling, context & runtime rules",
    monitor: "Loaded models · memory/GPU monitor · lms CLI control",
    scenarios: "Scenario purpose, tools, scoring & prompt preview",
    harness: "Bench/stress harness design & techniques — reference for other projects",
  },
  themeSelectAria: "Select theme",
  themeDark: "Dark",
  themeLight: "Light",
  themeSystem: "System",
  languageSelectAria: "Select language",
  navAria: "Main menu",
  benchProgress: (completed, total, pct) => `Running bench · ${completed}/${total} (${pct}%)`,
  benchProgressShort: "Running bench",
};
