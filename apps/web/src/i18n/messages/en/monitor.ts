import type { Messages } from "../ko";

// monitor — ko와 키가 정확히 일치해야 함(타입이 강제).
export const monitor: Messages["monitor"] = {
  refresh: "Refresh",
  polling: "Polling",
  interval: "Interval",
  intervalOption: (sec) => `${sec}s`,
  apiKeyLabel: "API Key (optional, session only)",
  apiKeyPlaceholder: "Enter if required",

  noData: "No data",
  loadedModels: (n) => `Loaded models (${n})`,
  noLoadedModels: "No loaded models",
  systemResources: "System resources",
  memory: "Memory",
  inactiveReason: (reason) => `Inactive — ${reason}`,

  notLoopbackLead: "The client IP is not loopback in this environment, so ",
  notLoopbackStrong: "the system/gpu/CLI cards are disabled",
  notLoopbackTail:
    " — only provider HTTP info is shown. (via nginx in Docker Compose, remote browser, etc.) — see the “Provider monitoring · lms CLI” section in the README.",
  notLocalhostLead:
    "baseUrl is not localhost, so system/gpu info is disabled. Set baseUrl to",
  notLocalhostTail: " or similar.",

  providerHttpFailed: (status, detail) => `provider HTTP call failed — ${status} ${detail}`,

  loadUnloadTitle: "Load / unload model (LM Studio CLI)",
  modelIdLabel: "Model ID (e.g. publisher/model)",
  modelIdPlaceholder: "Model identifier LM Studio recognizes",
  processing: "Processing…",
  actionFailed: (action, detail) => `${action} failed: ${detail}`,
  actionError: (action, detail) => `${action} error: ${detail}`,

  logStreamTitle: "lms server log stream",
  start: "Start",
  stop: "Stop",
  clear: "Clear",
  noLines: "No lines",
  logStreamConnError:
    "Connection closed or error (another client is using it, or the lms process ended)",
  logStreamHint: (cap) =>
    `Up to ${cap} lines. Server is a 1:1 lock — 409 if another client is already receiving.`,

  memoryMonitor: "Memory monitor",
  systemRam: "System RAM",
  widgetNotLoopback: "Not a loopback environment — disabled",
  widgetNotLocalhost: "baseUrl is not localhost — disabled",

  bandLabel: { high: "Excellent", good: "Good", mid: "Fair", low: "Low" },

  colModel: "Model",
  colRoute: "Route",

  agentEmptyState:
    'No agent scenario runs measured — enable "Agents only" in the scenario selection and run a bench.',
  agentTableCaption: "Agent capability metrics by model × route",
  nColTitleAgent: "Number of agent runs in this (model, route) slice",
  agentMetricLabel: {
    task_completion_rate: "Completion",
    stall_rate: "Stall",
    budget_exhausted_rate: "Budget exh.",
    thinking_budget_rate: "Think budget",
    task_ms_median: "Task ms",
    turns_median: "Turns",
    valid_tool_call_rate_mean: "Valid calls",
    tool_arg_fidelity: "Arg fidelity",
    arg_attempt_rate: "Arg attempt",
    output_efficiency: "Output eff.",
    quality_mean: "Quality (rubric)",
    workflow_adherence_mean: "Workflow",
    tool_call_excess_mean: "Tool excess",
  },
  agentMetricTitle: {
    task_completion_rate: "completed / all agent runs — higher is better",
    stall_rate: "stall / all — empty-turn stall ratio (lower is better)",
    budget_exhausted_rate: "budget_exhausted / all — maxTurns exhaustion ratio (lower is better)",
    thinking_budget_rate:
      "thinking_exhausted_budget=true ratio — per-turn budget exhausted by thinking (lower is better)",
    task_ms_median: "median total_ms of completed runs — wall-clock per completed task (lower is better)",
    turns_median: "median turns_to_completion of completed runs",
    valid_tool_call_rate_mean:
      "mean ratio of valid tool_call turns. Denominator includes the final tool-less turn → k/(k+1) for k turns (higher is better)",
    tool_arg_fidelity:
      "Σtool_arg_hits / Σattempts — ratio of opaque ids copied exactly (higher is better). argDispatch scenarios only",
    arg_attempt_rate:
      "ratio of runs with attempts>0 — low means giving up on the call itself when seeing a complex id (read together with fidelity)",
    output_efficiency:
      "Σfinal-turn tokens / Σall-turn usage tokens — inverse of intermediate-turn thinking waste (higher is better)",
    quality_mean:
      "deterministic rubric mean — **0–1 scale** (different meaning from other ratio metrics). The scoreboard main quality pools routes, so here we see per-route divergence",
    workflow_adherence_mean:
      "ratio of scenario-instructed tools actually called — **not reflected in the score** (using fewer and still correct is efficient). Diagnostic metric for interpreting ranking",
    tool_call_excess_mean:
      "excess tool-call ratio max(0, actual/expected−1) — 0=no waste, >0=overuse (e.g. calling the same tool repeatedly until budget is exhausted). Calling fewer is 0 and the 'Workflow' column measures that separately. error_v1's expectation includes retries, so this metric does not catch retry failures (that's the quality rubric's job)",
  },

  leakMetricLabel: {
    thinking_leak: "Thinking leak",
    empty_turn: "Empty turn",
    channel_tag: "Channel tag",
  },
  leakMetricTitle: {
    thinking_leak:
      "thinking_leak_ratio = reasoning tokens / total output tokens — lower means thinking leaks less into the final answer",
    empty_turn:
      "empty_turn_rate = ratio of runs with empty content and no tool_call — an agent-stall signal",
    channel_tag: "channel_tag_leak = ratio of runs where <think>/<|channel|> tags remain in content",
  },
  leakEmptyState: "No measured runs to compute leak/stall metrics.",
  leakTableCaption: "Leak/stall metrics by model × route",
  safeCol: "Safe",
  safeColTitle: "agent-safe when all three metrics are at or below the threshold",
  nColTitleLeak: "Number of measured runs in this (model, route) slice",
  leakWarningTitle: "Leak/stall threshold exceeded — caution for agent loops",
  warningAria: "Caution",

  close: "Close",
  imageModalCloseAria: "Close image modal",
  imageModalFooter: (url) => `${url} · close with Esc / background click`,
};
