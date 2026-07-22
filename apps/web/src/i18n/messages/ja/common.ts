import type { Messages } from "../ko";

// common — ko와 키가 정확히 일치해야 함(타입이 강제).
export const common: Messages["common"] = {
  confirm: "OK",
  cancel: "キャンセル",
  close: "閉じる",
  processing: "処理中…",
  copy: "コピー",
  copied: "コピーしました",
  retry: "再試行",
  skipToContent: "本文へスキップ",
  codeScrollable: "コード内容 (スクロール可能)",
  syntaxHighlightLazy: "構文ハイライト (lazy)",
  quantTitle: (quant) => `量子化 ${quant}`,
  backendOpenaiCompatible: "OpenAI互換",
  backendManual: "手動",
  errorBoundary: {
    title: "このページの表示中にエラーが発生しました",
    body: "別のタブに移動すれば引き続き利用できます。問題が繰り返す場合は、下のエラー内容とあわせてお知らせください。",
  },
};
