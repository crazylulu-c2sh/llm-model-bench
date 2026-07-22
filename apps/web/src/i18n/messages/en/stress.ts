import type { Messages } from "../ko";

// stress — ko와 키가 정확히 일치해야 함(타입이 강제).
export const stress: Messages["stress"] = {
  workload: {
    stress_ping: "Short ping (English)",
    stress_short_reply: "Short reply (English)",
    stress_short_reply_ko: "Short reply (Korean)",
    stress_short_reply_ja: "Short reply (Japanese)",
    stress_long_context: "Long context / prefill load (English)",
    stress_long_context_ko: "Long context / prefill load (Korean)",
    stress_long_context_ja: "Long context / prefill load (Japanese)",
  },

  intro: {
    heading: "Provider Bench — v1",
    before:
      "Measures how throughput (TPS) changes when multiple users use the same model concurrently. The primary metric is ",
    emphasis: "aggregate TPS vs. concurrent users",
    after:
      ". OS metrics such as memory/CPU usage are not provided in v1.",
  },

  detect: {
    heading: "1) Provider detection",
    apiKeyLabel: "API key (optional)",
    detectBtn: "Detect",
    persistLabel: "Save API key in this browser (local disk, plaintext)",
    persistWarnBefore: "When off, it is kept only in this tab's ",
    persistWarnMid:
      ", so it survives refreshes but may be lost when the browser closes. When on, it remains in ",
    persistWarnAfter: " as plaintext and may be exposed to XSS and the like.",
    models: (n) => `${n} models`,
    routes: (list) => `Routes ${list}`,
    routesNone: "none",
  },

  model: {
    heading: "2) Model selection (single)",
    selectedLabel: "Selected:",
    hint: "v1 measures *one model* only. Click the row again to deselect.",
  },

  ramp: {
    heading: "3) Workload & ramp",
    workload: "Workload",
    startCC: "Start concurrency",
    maxCC: "Max concurrency",
    step: "Step",
    stageDuration: "Stage duration (ms)",
    requestTimeout: "Request timeout (ms)",
    perWorkerSuffix: "Per-worker client suffix",
    expectedStages: "Expected stages:",
    expectedLanguage: "Expected response language:",
    longContextTips:
      "Long-context tips: temperature 0 · timeout ≥ 120s · leave max_tokens empty (32) · disable per-worker client suffix (prefix-caching engines)",
  },

  preview: {
    heading: "4) Prompt preview (identical to the actual request)",
  },

  run: {
    runBtn: "Run",
    stopBtn: "Stop",
    running: (tps) => `Running · live TPS ${tps}`,
    runningIdle: "Running…",
  },

  memNote: {
    label: "Memory metrics",
    body:
      ": N/A in v1 — the LM Studio REST API has no runtime memory endpoint, so it was scoped out.",
  },

  grid: {
    region: "Concurrent user monitor",
    regionFinished: "Concurrent user monitor (final snapshot)",
    regionError: "Concurrent user monitor (error snapshot)",
    preparing: (slots) => `${slots} slots reserved · preparing…`,
    runningStage: (stage, concurrency, slots) =>
      `Stage ${stage} · ${concurrency}/${slots} concurrent active`,
    lastStage: (stage, concurrency) =>
      `Last stage ${stage} · ${concurrency} concurrent`,
    tagFinished: "finished",
    tagAborted: "aborted",
    tagError: "error",
    liveWorkers: "Concurrent workers live",
    truncated: (concurrency, shown, hidden) =>
      `Only ${shown} of ${concurrency} concurrent users are shown live — the other ${hidden} are still reflected in the aggregate chart & table`,
  },

  chart: {
    heading: "Concurrent users vs. aggregate TPS",
    headingNote: "Per-user TPS bar color = perceived tier",
    ariaLabel:
      "Aggregate TPS chart by concurrent-user stage — see the per-stage results table for exact values",
    xLabel: "Concurrent users",
    legendAggregate: "Aggregate TPS",
    legendPerUser: "Per-user TPS",
    legendPerUserColored: "Per-user TPS (color = perceived tier)",
    perUserPrefix: "Per-user TPS:",
    footNoteBefore: "· Table stages where aggregate TPS is ",
    footNoteAfter:
      " (low confidence) omit the bar and turn gray · approx is a chars/4 estimate, so CJK may appear one tier lower",
    explain:
      "Updated at the end of each ramp stage. As concurrency rises, a plateau in TPS signals the throughput ceiling; a drop signals queuing/resource contention.",
  },

  worker: {
    streaming: "Streaming",
    done: "Done",
    error: "Error",
    requesting: "Requesting",
    idle: "Idle",
    userNumber: (n) => `User #${n}`,
    response: "Response",
    thinking: "🧠 thinking",
    reqCount: (n) => `req ${n}`,
    last: (v) => `last ${v}`,
  },

  progress: {
    label: "Stage progress",
    valueText: (pct) => `Stage progress ${pct}%`,
    valueTextDraining: (pct) => `Stage progress ${pct}% · draining`,
    draining: "draining…",
  },

  tpsTier: {
    fast: "Great",
    good: "Usable",
    okay: "Acceptable",
    slow: "Too slow",
  },
  tpsUnreliableTooltip: "— (low confidence)",

  table: {
    heading: "Per-stage results",
    caption: "Stress bench results by concurrency stage",
    concurrency: "Concurrency",
    tpsPerUser: "TPS/user",
    successRate: "Success rate",
    totalP50: "Total p50",
    totalP95: "Total p95",
    ttftTitle: "Time To First Token (prefill · KV cache metric)",
    errorRate: "Error rate",
    expectedResponseRate: (script) => `Expected response rate (${script})`,
    lowConfidence: "Low confidence",
    empty: "No results yet.",
    perUserHeaderTitle: (fast, good, okay) =>
      `Color: comfortable ≥${fast} · usable ${good}–${fast - 1} · acceptable ${okay}–${good - 1} · too slow <${okay}`,
    allApproxNote:
      "For this run the provider did not report usage token counts, so TPS was computed from a chars/4 estimate (approx) in every stage. CJK responses have fewer characters per token, so the under-estimation error is large.",
    mixedNoteBefore: "Some stages fell back to ",
    mixedNoteMid1: " (or ",
    mixedNoteMid2:
      ") — the provider did not send usage for those requests, or rejected ",
    mixedNoteAfter:
      ". TPS for approx stages is a chars/4 estimate, with a large error on CJK responses.",
    unreliableNoteBefore: "Stages where aggregate TPS is ",
    unreliableNoteMid:
      " (low confidence — too few samples · stage too short · no successes) show the TPS/user cell in gray (",
    unreliableNoteAfter: ").",
  },

  stats: {
    filterHeading: "Filters",
    all: "All",
    apply: "Apply",
    applying: "Applying…",
    reset: "Reset",
    runsHeading: (count, hasMore) => `Provider runs (${count}${hasMore ? "+" : ""})`,
    loading: "Loading…",
    empty: "No runs to show. Run one at /stress first.",
    loadMore: "Load more",
    loadingMore: "Loading more…",
    deleteRunAria: "Delete run",
    detailHeading: "Details",
    selectRun: "Select a run from the list above.",
    runningBefore: "This run is in progress — ",
    runningLink: "view live monitoring",
    runningAfter: ". Only stages completed so far are shown.",
    confirmTitle: "Delete provider run",
    confirmDelete: "Delete",
    confirmBody:
      "This run and all its stage results will be permanently deleted (cannot be undone).",
    confirmLiveWarn:
      "⚠ This is a live run — risk of data corruption if it is running concurrently at /stress.",
    field: {
      model: "Model",
      provider: "Provider",
      workload: "Workload",
      status: "Status",
      started: "Started",
      finished: "Finished",
    },
  },

  toast: {
    selectModel: "Detect a provider and select one model.",
    benchError: (code) => `Provider bench error: ${code}`,
    aborted: "Aborted — partial results are kept.",
    detectFailed: (status, detail) => `Detection failed: ${status} ${detail}`,
    detectException: (err) => `Detection exception: ${err}`,
    serverError: (status, detail) => `Server error: ${status} ${detail}`,
    streamException: (err) => `Stream exception: ${err}`,
    sqliteUnavailable: "SQLite is unavailable.",
    runGone: "This run no longer exists.",
    detailLoadFailed: (status) => `Failed to load details (${status})`,
    deleteFailed: (status) => `Delete failed (${status})`,
    deleted: "Deleted",
  },
};
