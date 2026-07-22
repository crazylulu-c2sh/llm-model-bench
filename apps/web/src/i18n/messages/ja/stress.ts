import type { Messages } from "../ko";

// stress — ko와 키가 정확히 일치해야 함(타입이 강제).
export const stress: Messages["stress"] = {
  workload: {
    stress_ping: "短いping（英語）",
    stress_short_reply: "短い応答（英語）",
    stress_short_reply_ko: "短い応答（韓国語）",
    stress_short_reply_ja: "短い応答（日本語）",
    stress_long_context: "長いコンテキスト / プレフィル負荷（英語）",
    stress_long_context_ko: "長いコンテキスト / プレフィル負荷（韓国語）",
    stress_long_context_ja: "長いコンテキスト / プレフィル負荷（日本語）",
  },

  intro: {
    heading: "プロバイダーベンチ — v1",
    before:
      "同じモデルを複数のユーザーが同時に使うとき、スループット（TPS）がどう変化するかを測定します。第一の指標は",
    emphasis: "同時ユーザー数に対する集計TPS",
    after: "です。メモリ・CPU使用量などのOS指標はv1では提供しません。",
  },

  detect: {
    heading: "1) プロバイダー検出",
    apiKeyLabel: "API key（任意）",
    detectBtn: "検出",
    persistLabel: "このブラウザにAPIキーを保存（ローカルディスク・平文）",
    persistWarnBefore: "オフにすると同じタブ内でのみ ",
    persistWarnMid:
      " に保存され、リロードは維持されますがブラウザを閉じると消えることがあります。オンにすると ",
    persistWarnAfter: " に平文で残り、XSSなどに晒される可能性があります。",
    models: (n) => `モデル${n}個`,
    routes: (list) => `ルート ${list}`,
    routesNone: "なし",
  },

  model: {
    heading: "2) モデル選択（単一）",
    selectedLabel: "選択済み:",
    hint: "v1は*1つのモデル*のみ測定します。行をもう一度クリックで解除できます。",
  },

  ramp: {
    heading: "3) ワークロード & ramp",
    workload: "ワークロード",
    startCC: "開始同時実行",
    maxCC: "最大同時実行",
    step: "ステップ",
    stageDuration: "ステージ duration (ms)",
    requestTimeout: "リクエスト timeout (ms)",
    perWorkerSuffix: "ワーカー別clientサフィックス",
    expectedStages: "想定ステージ数:",
    expectedLanguage: "想定応答言語:",
    longContextTips:
      "長いコンテキスト推奨: temperature 0 · timeout ≥ 120s · max_tokensを空に(32) · ワーカー別clientサフィックスをオフ(prefix cachingエンジン)",
  },

  preview: {
    heading: "4) プロンプトプレビュー（実際のリクエストと同一）",
  },

  run: {
    runBtn: "実行",
    stopBtn: "停止",
    running: (tps) => `実行中 · ライブTPS ${tps}`,
    runningIdle: "実行中…",
  },

  memNote: {
    label: "メモリ指標",
    body:
      ": v1ではN/A — LM Studio REST APIにランタイムメモリのエンドポイントが無いためスコープ外としました。",
  },

  grid: {
    region: "同時ユーザーモニター",
    regionFinished: "同時ユーザーモニター（終了スナップショット）",
    regionError: "同時ユーザーモニター（エラースナップショット）",
    preparing: (slots) => `${slots}人を事前確保 · 準備中…`,
    runningStage: (stage, concurrency, slots) =>
      `ステージ ${stage} · 同時 ${concurrency}/${slots}人 稼働`,
    lastStage: (stage, concurrency) =>
      `最終ステージ ${stage} · 同時 ${concurrency}人`,
    tagFinished: "終了",
    tagAborted: "中断",
    tagError: "エラー",
    liveWorkers: "同時ワーカーライブ",
    truncated: (concurrency, shown, hidden) =>
      `同時ユーザー${concurrency}人のうち${shown}人のみライブ表示 — 残り${hidden}人は集計チャート・表にそのまま反映されます`,
  },

  chart: {
    heading: "同時ユーザー vs 集計TPS",
    headingNote: "ユーザーあたりTPSの棒の色 = 体感ランク",
    ariaLabel:
      "同時ユーザーのステージ別集計TPSチャート — 詳しい値はステージ別結果表を参照",
    xLabel: "同時ユーザー数",
    legendAggregate: "集計TPS",
    legendPerUser: "ユーザーあたりTPS",
    legendPerUserColored: "ユーザーあたりTPS（色 = 体感ランク）",
    perUserPrefix: "ユーザーあたりTPS:",
    footNoteBefore: "· 表の集計TPSが ",
    footNoteAfter:
      "（低信頼性）のステージは棒を省略しグレー表示 · approxはchars/4推定のためCJKでは1ランク低く見えることがあります",
    explain:
      "rampステージ終了ごとに更新されます。同時実行が増えてTPSが平坦になれば処理量の上限、低下すればキューイング/リソース競合の兆候です。",
  },

  worker: {
    streaming: "ストリーミング",
    done: "完了",
    error: "エラー",
    requesting: "リクエスト中",
    idle: "待機",
    userNumber: (n) => `ユーザー #${n}`,
    response: "応答",
    thinking: "🧠 思考中",
    reqCount: (n) => `req ${n}件`,
    last: (v) => `最終 ${v}`,
  },

  progress: {
    label: "ステージ進行",
    valueText: (pct) => `ステージ進行 ${pct}%`,
    valueTextDraining: (pct) => `ステージ進行 ${pct}% · drain中`,
    draining: "drain中…",
  },

  tpsTier: {
    fast: "快適",
    good: "実用的",
    okay: "採用可能",
    slow: "遅すぎる",
  },
  tpsUnreliableTooltip: "— (信頼度低)",

  table: {
    heading: "ステージ別結果",
    caption: "同時実行ステージ別のストレスベンチ結果",
    concurrency: "同時実行",
    tpsPerUser: "TPS/ユーザー",
    successRate: "成功率",
    totalP50: "総 p50",
    totalP95: "総 p95",
    ttftTitle: "Time To First Token（prefill・KVキャッシュ指標）",
    errorRate: "エラー率",
    expectedResponseRate: (script) => `想定応答率(${script})`,
    lowConfidence: "低信頼性",
    empty: "まだ結果がありません。",
    perUserHeaderTitle: (fast, good, okay) =>
      `色: 快適 ≥${fast} · 十分 ${good}–${fast - 1} · 許容可 ${okay}–${good - 1} · 遅すぎ <${okay}`,
    allApproxNote:
      "このランではproviderがusageトークン数を報告しなかったため、全ステージでchars/4推定値(approx)でTPSを計算しました。CJK応答はトークンあたりの文字数が少なく、過小推定の誤差が大きくなります。",
    mixedNoteBefore: "一部のステージが ",
    mixedNoteMid1: "（または ",
    mixedNoteMid2:
      "）に落ちました — providerが該当リクエストでusageを送らなかったか、",
    mixedNoteAfter:
      " を拒否した場合です。approxステージのTPSはchars/4推定値で、CJK応答では誤差が大きくなります。",
    unreliableNoteBefore: "集計TPSの ",
    unreliableNoteMid:
      "（低信頼性 — サンプル不足・ステージが短すぎ・成功なし）のステージは、TPS/ユーザーのセルがグレー（",
    unreliableNoteAfter: "）で表示されます。",
  },

  stats: {
    filterHeading: "フィルター",
    all: "すべて",
    apply: "適用",
    applying: "適用中…",
    reset: "リセット",
    runsHeading: (count, hasMore) => `プロバイダーラン (${count}件${hasMore ? "+" : ""})`,
    loading: "読み込み中…",
    empty: "表示するランがありません。まず /stress で実行してください。",
    loadMore: "もっと見る",
    loadingMore: "さらに読み込み中…",
    deleteRunAria: "ランを削除",
    detailHeading: "詳細",
    selectRun: "上のリストからランを選択してください。",
    runningBefore: "このランは進行中です — ",
    runningLink: "ライブモニタリングを見る",
    runningAfter: "。現在までに完了したステージのみ表示されます。",
    confirmTitle: "プロバイダーランを削除",
    confirmDelete: "削除",
    confirmBody: "このランとすべてのステージ結果が完全に削除されます（元に戻せません）。",
    confirmLiveWarn:
      "⚠ ライブ実行中のランです — /stressで同時に実行中の場合、データ破損の恐れがあります。",
    field: {
      model: "モデル",
      provider: "プロバイダー",
      workload: "ワークロード",
      status: "ステータス",
      started: "開始",
      finished: "終了",
    },
  },

  toast: {
    selectModel: "プロバイダーを検出してモデルを1つ選択してください。",
    benchError: (code) => `プロバイダーベンチのエラー: ${code}`,
    aborted: "中断しました — 部分的な結果は保持されます。",
    detectFailed: (status, detail) => `検出に失敗: ${status} ${detail}`,
    detectException: (err) => `検出例外: ${err}`,
    serverError: (status, detail) => `サーバーエラー: ${status} ${detail}`,
    streamException: (err) => `ストリーム例外: ${err}`,
    sqliteUnavailable: "SQLiteを使用できません。",
    runGone: "このランはもう存在しません。",
    detailLoadFailed: (status) => `詳細の読み込みに失敗 (${status})`,
    deleteFailed: (status) => `削除に失敗 (${status})`,
    deleted: "削除しました",
  },
};
