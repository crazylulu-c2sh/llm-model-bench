import type { Messages } from "../ko";

// common — ko와 키가 정확히 일치해야 함(타입이 강제).
export const common: Messages["common"] = {
  redetectRequired: "Detect the provider again after changing connection details before running.",
  httpError: (status: number) => `Request failed (HTTP ${status})`,
  settings: "Settings",
  incompleteSettings: "Incomplete settings",
  confirm: "OK",
  cancel: "Cancel",
  close: "Close",
  processing: "Processing…",
  copy: "Copy",
  copied: "Copied",
  retry: "Retry",
  skipToContent: "Skip to content",
  codeScrollable: "Code content (scrollable)",
  syntaxHighlightLazy: "Syntax highlight (lazy)",
  quantTitle: (quant) => `Quantization ${quant}`,
  backendOpenaiCompatible: "OpenAI-compatible",
  backendManual: "Manual",
  errorBoundary: {
    title: "Something went wrong while showing this page",
    body: "You can keep using the app by switching to another tab. If the problem persists, let us know with the error details below.",
  },
  wslLoopbackHintBefore:
    "This bench server is in WSL. Keep Base URL as localhost — connections are forwarded to the Windows host ",
  wslLoopbackHintAfter: ".",
  wslUseLocalhost: "Use localhost",
  wslUseLocalhostAria: (url) => `Change Base URL to ${url}`,
};
