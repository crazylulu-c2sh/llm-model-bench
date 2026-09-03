import type { Messages } from "../ko";

// bench — ko와 키가 정확히 일치해야 함(타입이 강제).
export const bench: Messages["bench"] = {
  errors: {
    request_timeout: "リクエストタイムアウト",
    upstream_exception: "アップストリーム処理例外",
    provider_or_model_unavailable: "プロバイダー/モデルの準備不可",
    pre_bench_wait_timeout: "事前待機タイムアウト — 他の推論が実行中",
    between_iteration_wait_timeout: "反復間の待機タイムアウト — 他の推論が実行中",
    total_wait_budget_exceeded: "累積待機バジェット超過で中断",
    contention_max_retries_exceeded: "競合リトライ上限超過でラン中断",
  },
  sortLabels: {
    id: "モデル id",
    publisher: "配信元",
    label: "label",
    params_string: "規模",
    size_bytes: "ディスク",
  },

  // 接続 / 検出
  detectButton: "接続 / 検出",
  detectAria: "接続してプロバイダーを検出",
  detecting: "プロバイダーを検出中…",
  apiKeyLabel: "API キー (任意)",
  apiKeyPlaceholder: "Bearer / ゲートウェイキー",
  persistApiKeyLabel: "このブラウザに API キーを保存 (ローカルディスク・平文)",
  persistApiKeyHintA: "オフにすると同じタブ内の ",
  persistApiKeyHintB:
    " にのみ保持され、リロードでは維持されますがブラウザを閉じると消える場合があります。オンにすると ",
  persistApiKeyHintC: " に平文で残り、XSS などで露出する可能性があります。",

  // シナリオ選択
  runScenariosLabel: "実行シナリオ",
  categoryText: "テキスト",
  categoryVision: "ビジョン",
  categoryAgent: "エージェント",
  scenarioRequiredHint: "実行するシナリオを 1 つ以上選択してください。",
  settingsInitial: "初期値",
  settingsRecommended: "推奨値",
  settingsInitialTitle:
    "ハーネスの工場既定値に戻します。プロファイル自動、思考オン、Qwen3.8 effort low、max_tokens 空欄、高度設定（ロード・メモリ・汚染ガード）も既定値。Base URL と API キーは維持します。",
  settingsRecommendedTitle:
    "モデルカードの推奨に合わせます。思考オン、スループットモードオフ、Qwen3.8 effort xhigh、max_tokens は空欄のままシナリオ別推奨値を使います。ロード・メモリ・汚染ガードは変更しません。",
  toggleTextTitle: (n) => `テキストシナリオ ${n}個をトグル`,
  toggleVisionTitle: (n) => `ビジョンシナリオ ${n}個をトグル`,
  toggleAgentTitle: "エージェントシナリオをトグル",
  selectAllCategoriesTitle: "テキスト + ビジョン + エージェント 全選択",
  textCountButton: (n) => `テキスト (${n}個)`,
  visionCountButton: (n) => `ビジョン (${n}個)`,
  agentCountButton: (n) => `エージェント (${n}個)`,
  selectAllCountButton: (n) => `全選択 (${n}個)`,
  clearAll: "すべて解除",
  textScenariosHeading: "テキストシナリオ",
  visionScenariosHeading: "ビジョンシナリオ",
  visionScenariosNote: "(opt-in · ビジョン非対応モデルは 400/拒否あり · 呼び出しコスト ↑)",
  agentScenariosHeading: "エージェントシナリオ",
  agentScenariosNote: "(opt-in · マルチターン agent_loop)",
  customAgentScenariosHeading: "カスタム · エージェントシナリオ",
  customAgentScenariosNote: "(agent_loop · ユーザー登録 — サーバーに登録済みのもの)",

  // ロード/アンロード · メモリ · 競合ガードのトグル
  unloadOthersTitleLmStudio:
    "検出したモデル一覧にある他のモデルに対して unload を試みます。一覧にないロードは操作できません。",
  onlyLmStudio: "LM Studio でのみ適用されます。",
  unloadOthersLabel: "ベンチ対象以外のモデルをアンロード (LM Studio)",
  unloadOthersHint:
    "オンにすると各ベンチ開始前に、検出した他のモデルキーへ unload をベストエフォートで呼び出します。失敗してもベンチは続行します。",
  inactiveOnCurrentProvider: " 現在のプロバイダーでは無効です。",
  autoUnloadTitleLmStudio:
    "開始時点ですでに VRAM にあったモデルはアンロードせず、今回の実行が load で載せた場合のみ終了時に unload を試みます。",
  autoUnloadLabel: "ベンチ後に対象モデルを自動アンロード (LM Studio)",
  autoUnloadHint:
    "すでにロード済みのモデルはそのままにし、今回のベンチがロードした場合のみ、ラン終了時に unload をベストエフォートで呼び出します。",
  memFitTitle:
    "候補ロード前に必要 RAM と空き RAM を予測します。合わないときの動作を選びます (LM Studio)。",
  memFitLabel: "メモリフィット プリフライト (LM Studio)",
  memFitHintA: "候補ロード前に必要 RAM を予測してログします。合わない場合: ",
  memFitUnload: "アンロードして合わせる",
  memFitHintB: " は他のロード済みモデルをアンロードして空きを作り、",
  memFitSkip: "スキップ",
  memFitHintC: " は raw 400 の代わりに理由を記録してスキップします。デフォルト(予測のみ)はそのまま進めます。",
  memFitOptionLog: "予測のみ(ログ)",
  memFitOptionSkip: "合わなければスキップ",
  loadTtlTitle:
    "ロード時に TTL(秒)を適用し、アイドル後に自動アンロードします。LM Studio は JIT ロード(最初の推論リクエスト)、Ollama は keep_alive で適用されます。",
  loadTtlLabel: "モデルロード TTL(秒) — LM Studio · Ollama",
  loadTtlHintA:
    "ロード時に指定した時間(秒)だけモデルを常駐させ、アイドル後に自動アンロードします。空にすると未適用(従来動作)。LM Studio は JIT ロード(最初の推論リクエスト)のペイロードの ",
  loadTtlHintB: "、Ollama はネイティブの ",
  loadTtlHintC: " で適用されます。Ollama は推論(",
  loadTtlHintD:
    ")が keep_alive をデフォルトの 5 分にリセットするため、ベンチ終了後に指定 TTL を再適用します。",
  /** ttl をそもそも送れなかった場合(明示的 load へのフォールバックなど)。 */
  loadTtlNotApplied: (modelId: string) =>
    `${modelId}: ロードTTL未適用 — ttl を送信できませんでした(アイドル自動アンロードなし)`,
  /** すでに常駐中で TTL を設定できなかった場合 — LM Studio の Idle TTL は JIT ロード時のみ設定可能。 */
  loadTtlNotAppliedResident: (modelId: string) =>
    `${modelId}: ロードTTL未適用 — モデルがすでに常駐中です。LM Studio は JIT ロード時のみ TTL を設定できるため、適用するには先にアンロードが必要です`,
  /** サーバーが ttl フィールドを 400/422 で拒否した場合(旧バージョン)。 */
  loadTtlRejected: (modelId: string) =>
    `${modelId}: ロードTTL拒否 — サーバーが ttl フィールドを拒否したため TTL なしで続行しました(アイドル自動アンロードなし)`,
  /** ttl を送信して 2xx を受け取ったが、適用を確認できない場合。 */
  loadTtlUnknown: (modelId: string) =>
    `${modelId}: ロードTTLの適用可否を確認できません — リクエストは成功しましたが、OpenAI 互換サーバーは未知のフィールドを黙って無視することがあります`,

  notApplied: "未適用",
  contentionGuardTitle:
    "他の推論(同一/別モデル)が実行中なら開始前に待機し、ベンチ中に検出したら汚染された測定ランのみ破棄して再測定します。",
  contentionGuardLabel: "競合ガード (他の推論を検出したら待機・再測定)",
  contentionGuardHint:
    "GPU util·/metrics·lms ps でアクティブな推論を検出します。信号がない環境では自動的に無効として扱われます。",
  preBenchTimeoutLabel: "事前待機の上限(秒)",
  retriesPerRunLabel: "ラン当たりのリトライ回数",

  // モデル選択 · プロファイル
  modelSelectHeading: "モデル選択",
  profileDetailLink: "プロファイルの数値・ルール詳細",
  profile: "プロファイル",
  profileSelectAria: "ベンチプロファイル",
  profileAuto: "自動(モデル id から推定)",
  profileUnknown: "unknown (デフォルトサンプリング)",
  thinkingIntentLabel: "思考(thinking)の意図",
  thinkingLockedTitle: "パフォーマンス測定モードでは off に固定されます",
  thinkingOn: "オン (デフォルト)",
  thinkingOff: "オフ (Qwen·Nemotron: enable_thinking=false)",
  throughputModeLabel: "パフォーマンス測定モード(スループット)",
  throughputHintA: "スループット比較用の apples-to-apples 測定 — 思考 ",
  throughputHintB: " 単一ルート · max_tokens ",
  throughputHintC: " 固定。オンにすると上の 思考·max_tokens·preset 設定は無視されます。",
  throughputNoChatRoute: "このプロバイダーは chat_completions ルートがないため使用できません。",
  maxTokensLabel: "max_tokens (空欄でモデルカードの推奨値)",
  maxTokensPlaceholder: "例: 32768",
  qwen38ReasoningEffortLabel: "Qwen3.8 reasoning_effort",
  qwen38ReasoningEffortHint:
    "モデルカードの既定は xhigh ですが、思考トークンが膨張するためハーネスの既定は low です。精度が必要なら上げてください。",
  preserveThinkingHint: "エージェント型のマルチターンでのみオンにすることを推奨します。",
  advancedSummary: "詳細: 推論 · サンプリング · モデルロード/メモリ · 汚染ガード",
  presetOverrideLabel: "preset を強制 (空欄で自動)",
  presetAuto: "自動",
  samplingOverridesLabel: "samplingOverrides (JSON オブジェクト)",
  samplingOverridesInvalid: "有効な JSON オブジェクトではありません — オーバーライドは適用されません",
  noModelsPrefix: "検出されたモデルがありません。Base URL·API キーを確認してから再度 ",
  noModelsSuffix: " を実行してください。",
  emptyModelsPrefix: "まだモデル一覧がありません。",
  emptyModelsSuffix: " を実行すると一覧がここに表示されます。",

  // シナリオ詳細リンク
  scenarioDetailDocLink: "シナリオ詳細ドキュメント",

  // ベンチ実行アクション
  runSelected: "選択モデルをベンチ",
  runSelectedAria: "選択モデルのベンチを実行",
  selectScenarioTitle: "実行するシナリオを 1 つ以上選択してください",
  pauseBtn: "一時停止",
  pauseBtnAria: "実行中のベンチを一時停止",
  resumeBtn: "再開",
  resumeBtnAria: "一時停止したベンチを再開",
  stopBtn: "緊急停止",
  stopBtnAria: "実行中のベンチを緊急停止",

  // ベンチ実行確認ダイアログ
  confirmRun: "ベンチ実行",
  confirmOrderLabel: "実行順 · モデル ",
  confirmOrderUnit: "個",
  confirmLmStudioLoadNote: " · LM Studio でロード/アンロードが動作する場合があります。",
  confirmReorderHint: "上/下で直列実行の順序を変更できます。",
  moveUpAria: (modelId) => `${modelId} を上へ移動`,
  moveDownAria: (modelId) => `${modelId} を下へ移動`,
  confirmUnloadOthersOn: "ベンチ対象以外のモデルのアンロードがオンです(検出一覧基準)。",
  confirmAutoUnloadOn:
    "今回のベンチでロードした対象モデルのみ、終了時に自動アンロードします(すでにロード済みのモデルは維持)。",
  confirmLoadTtl: (seconds, via) =>
    `モデルロード TTL ${seconds}秒を適用します(${via})。モデルがすでに常駐中の場合は適用されないことがあります。`,
  estimatedFromOtherQuant: (quant) => `別の量子化(${quant})の記録に基づく`,
  estimatedTotalLabel: (text, covered, total) => `予想合計 ~${text} · 履歴あり ${covered}/${total}`,

  // メトリクスチャート
  metricsChartHeading: "メトリクスチャート",
  thisSession: "今回のセッション",
  compareStoredLast: "保存済み最終ランの比較",
  loadCompare: "比較を読み込む",
  compareHint: "選択モデル 2 個以上 · 比較の読み込みを実行",
  chartModels: "チャートモデル",
  compareSelectTwo: "比較チャートを見るには上でモデルを 2 個以上選択してください。",
  selectModelToShow: "表示するモデルを 1 つ以上選択してください。",

  // 結果 · プレビュー · ログ
  resultsTableHeading: "結果テーブル",
  tokenPreview: "トークンプレビュー (ストリーム)",
  logHeading: "ログ",
  collapseServerRuns: "サーバーラン一覧を折りたたむ",
  loadServerRuns: "サーバーに保存されたベンチランの一覧を読み込む",
  collapseList: "一覧を折りたたむ",
  serverRunsList: "サーバーラン一覧",
  downloadLastJsonAria: "最後の結果 JSON をダウンロード",
  downloadLastJson: "最後の結果 JSON をエクスポート",
  sqliteStoredRuns: "SQLite 保存ラン (クリックで最初のシナリオ詳細)",
  closeList: "一覧を閉じる",
  docLoading: "ドキュメントを読み込み中…",

  // トースト (sonner) — 発火時点のロケールで読む
  detectFirst: "先に 接続 / 検出 を実行してください。",
  compareNeedTwoModels: "比較するにはモデルを 2 個以上選択してください。",
  compareApiError: (status) => `比較 API エラー (${status})`,
  sqliteUnavailableCompare:
    "SQLite が使用できないため保存済みランを読み込めません。サーバーの DB ファイルのパス·権限·ロック状態を確認してください。",
  compareFewerThanTwoStored:
    "保存済みの最終ランがあるモデルが 2 個未満です。同じ Base URL でベンチを先に実行してください。",
  compareLoaded: "保存済み最終ラン基準の比較チャートを読み込みました。",
  runsListError: (status) => `ラン一覧エラー (${status})`,
  sqliteDisabledRunsList: "SQLite 無効 — サーバーラン一覧は使用できません。",
  serverRunsCount: (n) => `サーバーラン ${n}件`,
  runDetailError: (status) => `ランの取得に失敗 (${status})`,
  noScenarioData: "シナリオデータがありません。",
  detectFailed: "プロバイダーの検出に失敗しました。",
  reachabilityMessage: (code, detail) => {
    const head =
      code === "connect_timeout"
        ? "時間内に接続が確立しませんでした。ポートとホスト側の受信ファイアウォールを確認してください。"
        : code === "refused"
          ? "接続が拒否されました。そのポートでサーバーが起動しているか確認してください。"
          : code === "dns"
            ? "ホスト名を解決できませんでした。アドレスの綴りを確認してください。"
            : code === "tls"
              ? "TLS 接続に失敗しました。http/https の選択と証明書を確認してください。"
              : code === "partial"
                ? "モデル一覧ルートの一部のみ応答しました。ネットワークまたはプロキシ設定を確認してください。"
                : "Base URL に接続できません。サーバーが起動しているか·アドレス·ファイアウォールを確認してください。";
    return detail ? `${head} (${detail})` : head;
  },
  noModelsHintLmStudio: "LM Studio でモデルをロードしてから再試行してください。",
  noModelsHintGeneric: "モデル一覧が空です。Base URL·API キーを確認してください。",
  detectedNoModels: (hint) => `検出されましたがモデルがありません。${hint}`,
  detectSuccess: (provider, count) => `検出完了 · ${provider} · モデル ${count}個`,
  detectRequestError: "検出リクエスト中にエラーが発生しました。",
  selectScenarioToRun: "実行するシナリオを 1 つ以上選択してください。",
  selectModelToBench: "ベンチするモデルを 1 つ以上選択してください。",
  benchDoneWithIssues: "ベンチ終了 — エラー·未完了のストリームがありました。ログを確認してください。",
  benchAllDone: "ベンチがすべて完了しました。",
  benchCancelledToast: "ベンチを停止しました。",

  // 進行サマリー · イベントログ (BenchProgressPanel · pushBenchLine)
  streamConnecting: "ストリーム接続中…",
  lastState: (rest) => `最終状態 · ${rest}`,
  benchIdle: "ベンチ待機中。モデルを選択してから実行してください。",
  progressHeading: "ベンチ実行ステップ",
  progressRate: "進行率",
  progressRateValue: (pct, completed, total) => `進行率 ${pct}% · ${completed}/${total}`,
  etaRemaining: (text) => `~${text} 残り`,
  etaWaiting: "待機中…",
  eventLogHeading: "イベントログ",
  eventLogAria: "ベンチストリームのイベントログ",
  eventLogEmpty: "イベント受信待ち…",
  eventRunStart: (rid) => `ラン開始 · ${rid}`,
  eventMemFitDetail: (required, free) => `必要 ~${required}, 空き ${free}`,
  eventMemSkip: (modelId, detail) => `メモリ不足でスキップ · ${modelId} · ${detail}`,
  eventMemUnloadOthers: (modelId, detail) => `メモリ確保のため他モデルをアンロード · ${modelId} · ${detail}`,
  eventModelLoaded: (modelId) => `モデルロード完了 · ${modelId}`,
  unloadPhaseAfterBench: "ベンチ後 ",
  unloadPhasePreflightFit: "メモリ確保 ",
  eventUnloadDone: (phase, modelId, status) => `${phase}アンロード完了 · ${modelId} · ${status}`,
  eventUnloadFail: (phase, modelId, status) => `${phase}アンロード失敗 · ${modelId} · ${status}`,
  iterWarmup: (cur, total) => `ウォームアップ ${cur}/${total}`,
  iterMeasured: (cur, total) => `測定 ${cur}/${total}`,
  eventScenarioStart: (scenarioId, api, iterLabel) => `開始 · ${scenarioId} · ${api} (${iterLabel})`,
  eventRunFinished: (modelId) => `ラン完了 · ${modelId}`,
  eventRunCancelled: (modelId) => `停止しました · ${modelId}`,
  waitPhasePre: "事前",
  waitPhaseBetween: "反復間",
  eventContentionWaiting: (where, reason, gpu, elapsedMs) => `待機 · ${where} · ${reason}${gpu} (${elapsedMs}ms)`,
  eventContentionResumed: (waitedMs) => `再開 · ${waitedMs}ms 待機後`,
  eventRunPaused: "⏸ 一時停止しました",
  eventRunResumed: "▶ 再開しました",
  eventIterationDiscarded: (cur, max, scenarioId, reason) =>
    `競合破棄 · 再測定 ${cur}/${max} · ${scenarioId} · ${reason}`,
  guardIneffective: " · ガード無効(信号なし)",
  eventContentionSummary: (discarded, maxWaitMs, eff) =>
    `競合サマリー · 破棄 ${discarded}回 · 最大待機 ${maxWaitMs}ms${eff}`,
  eventAggregateDone: (scenarioId, apiLabel) => `集計完了 · ${scenarioId} · ${apiLabel}`,
  eventRequestFailed: (modelId, err) => `リクエスト失敗 · ${modelId}: ${err}`,
  eventQueueRestored: (done, total) => `キュー復元 · ${done}/${total} 完了`,
  eventRestoredFromDb: (runs, rows) => `保存済み結果を復元 · ラン${runs}件 (${rows}行)`,
  eventRestoreFailed: (runId) => `保存済み結果を読み込めませんでした · ${runId}`,
  queueConflictActive:
    "このサーバーでは既にベンチキューが実行中です。接続/検出をもう一度押すと進行状況に再接続します。",
  runConflictActive: "このサーバーで別のベンチが実行中です。終了後にもう一度お試しください。",
  logUnloadDone: (phase, modelId, status) => `${phase}モデルアンロード完了 · ${modelId} · HTTP ${status}`,
  logUnloadFail: (phase, modelId, status) => `${phase}モデルアンロード失敗 · ${modelId} · HTTP ${status}`,
  logBenchIncomplete: (modelId) => `bench incomplete: run_finished なし model=${modelId}`,

  // モデルテーブル (ModelTable)
  sortNone: "ソート: なし",
  sortAsc: "昇順",
  sortDesc: "降順",
  sortLine: (name, dir) => `ソート: ${name} · ${dir}`,
  deselectShown: "表示中の項目を解除",
  selectShown: "表示中の項目を選択",
  selectModelAria: (id) => `${id} を選択`,
  colParams: "規模",
  colDisk: "ディスク",
  colPublisher: "配信元",
  modelFilterPlaceholder: "モデル id·label を検索 (例: mtp)",
  modelFilterAria: "モデルフィルター",
  clearFilter: "フィルターをクリア",
  modelListCaption: "検出されたモデル一覧",
  noMatchingModels: "一致するモデルがありません",
  toggleSelectAria: (id) => `${id} の選択をトグル`,
  selectedCount: (n, total) => `選択 ${n} / ${total}`,
  filterShown: (q, count) => ` · フィルター "${q}": ${count}個表示`,
  someSelected: " · 一部選択",
  selectionLockedDuringBench: " · ベンチ実行中は選択を変更できません。",
  profileDocNavTitle: "プロファイルのドキュメントページへ移動",
  navigate: "移動",
  leaveForProfileDoc: "現在の画面を離れてプロファイルのドキュメントページへ移動します。",
  benchRunningNavNote: "ベンチが進行中です — 画面のみ切り替わり、実行はバックグラウンドで続行します。",

  // プロバイダーサマリー (ProviderSummary)
  serverUnreachable: "サーバーに到達できませんでした。",
  partialModelList: "モデル一覧ルートの一部のみ応答しました。",
  detectStep: (hint) => `検出ステップ: ${hint}`,
  modelCount: (n) => `モデル ${n}個`,

  // シナリオ案内カード (ScenarioGuideCards)
  scenarioGuideHeading: "ベンチシナリオ案内",
  scenarioGuideSummary: (n) => `${n}枚のカード`,
  scenarioGuideIntroA: "各カードはそのシナリオが何を検証するかを要約します。",
  scenarioGuideIntroB: " バッジのカードは画像入力を受け取り、ビジョン非対応モデルでは 400 になる場合があります。",
  enlargeImageAria: (id) => `${id} の画像を拡大`,
  enlarge: "拡大",
  passFailCriteria: "合格 / 不合格 の基準",
  noDescription: "登録された説明がありません。",
  // ── 6ステップアコーディオン (StepSection / QueueStatusChips) ────────────────
  wizard: {
    step1Title: "接続",
    step2Title: "シナリオ選択",
    step3Title: "設定",
    step4Title: "モデル選択",
    step5Title: "実行 / 進捗",
    step6Title: "結果",
    stepNumberAria: (n) => `ステップ${n}`,
    stepDoneAria: "完了",
    queueStatus: {
      pending: "待機",
      running: "実行中",
      paused: "一時停止",
      done: "完了",
      doneWithErrors: "一部エラー",
      failed: "失敗",
      cancelled: "中止",
    },
    queueMore: (n) => `他 ${n}件`,
    queueMoreAria: (n) => `未表示のモデル ${n}件`,
    step1Summary: (label, models) => `${label} · モデル ${models}個`,
    step1Unreachable: (label) => `${label} · 到達不可`,
    step1NotConnected: "未接続",
    step2Summary: (selected, total) => `${selected}/${total} 選択`,
    step3MaxDefault: "推奨値",
    step4Summary: (selected, total) => `${selected} / ${total} 選択`,
    step6Summary: (models, results) => `モデル ${models}個 · 結果 ${results}件`,
    step6Empty: "まだありません",
    queueListAria: "実行キューの状態",
  },
};
