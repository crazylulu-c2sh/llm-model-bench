import type { Messages } from "../ko";

// monitor — ko와 키가 정확히 일치해야 함(타입이 강제).
export const monitor: Messages["monitor"] = {
  refresh: "更新",
  polling: "ポーリング",
  interval: "間隔",
  intervalOption: (sec) => `${sec}秒`,
  apiKeyLabel: "API Key（任意・セッション限定）",
  apiKeyPlaceholder: "必要な場合に入力",

  noData: "データなし",
  loadedModels: (n) => `ロード済みモデル（${n}）`,
  noLoadedModels: "ロード済みモデルなし",
  systemResources: "システムリソース",
  memory: "メモリ",
  inactiveReason: (reason) => `無効 — ${reason}`,

  notLoopbackLead: "この環境ではクライアントIPがloopbackではないため、",
  notLoopbackStrong: "system/gpu/CLIカードは無効",
  notLoopbackTail:
    "です — provider HTTP情報のみ表示されます。（Docker Composeのnginx経由、リモートブラウザなど） — READMEの「Provider モニタリング · lms CLI」の項を参照してください。",
  notLocalhostLead: "baseUrl が localhost ではないため system/gpu 情報は無効です。baseUrl を",
  notLocalhostTail: " などに設定して使用してください。",

  providerHttpFailed: (status, detail) => `provider HTTP 呼び出し失敗 — ${status} ${detail}`,

  loadUnloadTitle: "モデルのロード/アンロード (LM Studio CLI)",
  modelIdLabel: "モデル ID（例: publisher/model）",
  modelIdPlaceholder: "LM Studio が認識するモデル識別子",
  processing: "処理中…",
  actionFailed: (action, detail) => `${action} 失敗: ${detail}`,
  actionError: (action, detail) => `${action} エラー: ${detail}`,

  logStreamTitle: "lms server ログストリーム",
  start: "開始",
  stop: "停止",
  clear: "クリア",
  noLines: "行なし",
  logStreamConnError: "接続終了またはエラー（他のクライアントが使用中、または lms プロセス終了）",
  logStreamHint: (cap) =>
    `最大 ${cap} 行。サーバーは 1:1 lock — 他のクライアントが受信中の場合は 409。`,

  memoryMonitor: "メモリモニター",
  systemRam: "システム RAM",
  widgetNotLoopback: "loopback ではない環境 — 無効",
  widgetNotLocalhost: "baseUrl が localhost ではない — 無効",

  bandLabel: { high: "優秀", good: "良好", mid: "普通", low: "低い" },

  colModel: "モデル",
  colRoute: "ルート",

  agentEmptyState:
    "エージェントシナリオの計測ランがありません — シナリオ選択で「エージェントのみ」をオンにしてベンチを実行してください。",
  agentTableCaption: "モデル × ルート別エージェント能力指標",
  nColTitleAgent: "この (モデル, ルート) スライスの agent ラン数",
  agentMetricLabel: {
    task_completion_rate: "完了率",
    stall_rate: "ストール率",
    budget_exhausted_rate: "バジェット枯渇率",
    thinking_budget_rate: "思考バジェット枯渇",
    task_ms_median: "タスクms",
    turns_median: "ターン",
    valid_tool_call_rate_mean: "有効呼び出し率",
    tool_arg_fidelity: "引数忠実度",
    arg_attempt_rate: "引数試行率",
    output_efficiency: "出力効率",
    quality_mean: "品質(rubric)",
    workflow_adherence_mean: "ワークフロー",
    tool_call_excess_mean: "ツール超過",
  },
  agentMetricTitle: {
    task_completion_rate: "completed / 全 agent ラン — 高いほど良い",
    stall_rate: "stall / 全体 — 空ターンストール率（低いほど良い）",
    budget_exhausted_rate: "budget_exhausted / 全体 — maxTurns 枯渇率（低いほど良い）",
    thinking_budget_rate:
      "thinking_exhausted_budget=true 率 — 思考で per-turn バジェットを枯渇（低いほど良い）",
    task_ms_median: "完了ランの total_ms 中央値 — 完了タスクあたりの実時間（低いほど良い）",
    turns_median: "完了ランの turns_to_completion 中央値",
    valid_tool_call_rate_mean:
      "有効な tool_call ターン率の平均。分母に最終の無ツールターンを含む → k ターンで k/(k+1)（高いほど良い）",
    tool_arg_fidelity:
      "Σtool_arg_hits / Σattempts — 不透明な id を正確にコピーした率（高いほど良い）。argDispatch シナリオのみ",
    arg_attempt_rate:
      "attempts>0 のラン率 — 低いと複雑な id を見て呼び出し自体を断念（忠実度と併せて読むこと）",
    output_efficiency:
      "Σ最終ターントークン / Σ全ターン usage トークン — 中間ターンの思考浪費の逆数（高いほど良い）",
    quality_mean:
      "決定論的 rubric 平均 — **0〜1 スケール**（他の比率指標と意味が異なる）。スコアボードのメイン品質はルートをプールするため、ここではルート別の乖離を見る",
    workflow_adherence_mean:
      "シナリオが指示したツールのうち実際に呼んだ率 — **スコアには反映されない**（少なく使って正解なら効率的）。順位解釈用の診断指標",
    tool_call_excess_mean:
      "ツール超過呼び出し率 max(0, 実際/期待−1) — 0=浪費なし、>0=乱用（例: 同じツールを繰り返し呼んでバジェット枯渇）。少なく呼んだものは 0 で「ワークフロー」列が別に測る。error_v1 の期待値はリトライを含むため、この指標はリトライ失敗を捕らえない（品質 rubric の役割）",
  },

  leakMetricLabel: {
    thinking_leak: "思考リーク",
    empty_turn: "空ターン",
    channel_tag: "チャンネルタグ",
  },
  leakMetricTitle: {
    thinking_leak:
      "thinking_leak_ratio = reasoning トークン / 総出力トークン — 低いほど思考が最終回答に漏れない",
    empty_turn:
      "empty_turn_rate = content が空で tool_call もないランの割合 — エージェント停滞のシグナル",
    channel_tag: "channel_tag_leak = <think>/<|channel|> タグが content に残ったランの割合",
  },
  leakEmptyState: "リーク/ストール指標を計算する計測ランがありません。",
  leakTableCaption: "モデル × ルート別リーク/ストール指標",
  safeCol: "安全",
  safeColTitle: "3 つの指標がすべて閾値以下なら agent-safe",
  nColTitleLeak: "この (モデル, ルート) スライスの計測ラン数",
  leakWarningTitle: "リーク/ストール閾値超過 — エージェントループに注意",
  warningAria: "注意",

  close: "閉じる",
  imageModalCloseAria: "画像モーダルを閉じる",
  imageModalFooter: (url) => `${url} · Esc / 背景クリックで閉じる`,
};
