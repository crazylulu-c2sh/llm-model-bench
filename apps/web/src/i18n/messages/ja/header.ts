import type { Messages } from "../ko";

// header — ko와 키가 정확히 일치해야 함(타입이 강제).
export const header: Messages["header"] = {
  nav: {
    bench: "モデルベンチ",
    stats: "モデル統計",
    stress: "プロバイダーベンチ",
    providerStats: "プロバイダー統計",
    profile: "プロファイル",
    monitor: "プロバイダーモニター",
    scenarios: "シナリオ",
    harness: "ハーネス",
  },
  subtitle: {
    bench: "ローカルプロバイダー検出 · 単一モデルのシナリオベンチ",
    stats: "SQLiteに保存された最新ランのメトリクス・結果",
    stress: "同時ユーザー負荷 · 段階別TPS · ライブワーカーモニター",
    providerStats: "SQLiteに保存されたプロバイダーベンチのラン — フィルター・エクスポート・削除",
    profile: "モデルファミリー別のサンプリング・コンテキスト・ランタイム適用ルール",
    monitor: "ロード済みモデル · メモリ・GPUモニター · lms CLI操作",
    scenarios: "シナリオの目的・ツール・採点・プロンプトプレビュー",
    harness: "ベンチ/ストレスハーネスの設計・技法 — 他プロジェクト参考用",
  },
  themeSelectAria: "テーマを選択",
  themeDark: "ダーク",
  themeLight: "ライト",
  themeSystem: "システム",
  languageSelectAria: "言語を選択",
  navAria: "メインメニュー",
  benchProgress: (completed, total, pct) => `ベンチ実行中 · ${completed}/${total} (${pct}%)`,
  benchProgressShort: "ベンチ実行中",
};
