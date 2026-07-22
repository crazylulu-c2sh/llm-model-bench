# ハーネスノウハウ

本プロジェクトのローカル LLM ベンチマーク／ストレスハーネスから抽出した、再利用可能な技術をまとめた公開成果物です — マルチプロバイダー抽象化、ストリーミングの TTFT/TPS 抽出、GPU 競合ガード、メモリ適合性プリフライト、マルチターンのエージェントループ、ランプ式ストレステスト、実行の永続化／回帰比較。各セクションは簡潔な技術リファレンスに続けて、正確なソースファイルへのポインタを示すので、システム全体を採用しなくても、他のプロジェクトが単一の技術だけを取り込めます。

> **メンテナンス。** ハーネス API（`apps/server/src/bench-runner.ts`、`openai-stream.ts`、`anthropic-stream.ts`、`stress-runner.ts`、`agent-loop.ts`、`contention-probe.ts`、`memory-preflight.ts` など）を変更する PR では、この文書内で該当する関数名・ファイル名を検索し、影響を受けるセクションの記述を更新してください。

## 目次

- [1. アーキテクチャとイベントモデル](#1-アーキテクチャとイベントモデル)
- [2. マルチプロバイダー抽象化](#2-マルチプロバイダー抽象化)
- [3. ストリーミングメトリクス抽出](#3-ストリーミングメトリクス抽出)
- [4. メモリ適合性プリフライトとOOMガード](#4-メモリ適合性プリフライトとoomガード)
- [5. プロバイダーのロード・アンロードとTTL](#5-プロバイダーのロードアンロードとttl)
- [6. 競合／汚染ガード](#6-競合汚染ガード)
- [7. ストレスランプとバックプレッシャー](#7-ストレスランプとバックプレッシャー)
- [8. マルチターンエージェントループハーネス](#8-マルチターンエージェントループハーネス)
- [9. 品質採点とLLM-as-judge](#9-品質採点とllm-as-judge)
- [10. 実行の永続化と回帰検出](#10-実行の永続化と回帰検出)
- [11. プロバイダーの落とし穴](#11-プロバイダーの落とし穴)
- [12. 再利用の方法（チェックリスト）](#12-再利用の方法チェックリスト)
- [付録 A. 用語集](#付録-a-用語集)
- [付録 B. リファレンス](#付録-b-リファレンス)

---

## 1. アーキテクチャとイベントモデル

これは、3 つのデプロイ可能なアプリが 1 つの共有ライブラリを import する pnpm ワークスペースのモノレポです。`@llm-bench/server`（`apps/server`）はベンチマークのオーケストレーションと SQLite 永続化を持つ Hono の HTTP サービス、`@llm-bench/web`（`apps/web`）は React SPA、`@llm-bench/mcp`（`apps/mcp`）は同じベンチマークを Model Context Protocol[^mcp-spec] のツールとして公開します。`@llm-bench/shared`（`packages/shared/src/index.ts`）が唯一の信頼できる情報源です。あらゆるワイヤー型 — `StreamEvent`、`BenchRunMeta`、`BenchResult`、リクエストボディ（`BenchStreamBodySchema`）、採点ロジック — が Zod スキーマとして一度だけ定義され、`z.infer` で TS 型に推論されるので、3 つのアプリすべてが同一の形状に対して検証します。再利用可能な中核は `apps/server/src/bench-runner.ts` の `runBench` です。これはソケットに書き込む代わりに型付きイベントのストリームを *yield* する `async function*`（`AsyncGenerator<StreamEvent>`）です。こうしてオーケストレーションはトランスポートから完全に分離されます — HTTP ルートは yield された各イベントを SSE フレームに適応させ、テストはジェネレータを直接反復し、MCP サーバーは同じ SSE エンドポイントをネットワーク越しに消費します。中核となる再利用パターンは「ジェネレータがイベントを yield し、コンシューマがトランスポートを決める」という分離です。`runBench` は SSE・WebSocket・HTTP といったトランスポート層を一切知りません。順番に `StreamEvent` を yield するだけで、どのコンシューマも `for await (const ev of runBench(...))` で受け取り、望む形（SSE フレーム、DB insert、テストの assertion）に適応させます。イベントスキーマを `shared` パッケージの Zod discriminated union に置くことが、この構造の契約（contract）です。

- **共有コントラクト。** `StreamEventSchema` は `packages/shared/src/index.ts` の `z.discriminatedUnion("type", [...])` です。判別子 `type` により、各コンシューマは網羅的に絞り込めます。検証はアプリごとではなく共有境界で行われます。
- **ジェネレータのシグネチャ**（`apps/server/src/bench-runner.ts`）:

```ts
export async function* runBench(
  input: BenchRequest,
  detect: DetectResult,
  opts: { fetchImpl?: typeof fetch; /* test-only injection: probeImpl, now, sleep, systemInfoImpl */ } = {},
): AsyncGenerator<StreamEvent>
```

- **トランスポートアダプタ。** ルートはジェネレータを `ReadableStream` でラップし、各イベントを 1 つの SSE フレームとしてシリアライズしつつ、永続化層へ tee します（`apps/server/src/routes/register.ts`）:

```ts
const push = (ev: StreamEvent) =>
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
for await (const ev of runBench(req, detect)) {
  if (ev.type === "run_started") {
    persister.start(ev.meta ?? makeBenchRunMeta(req, detect, ev.run_id));
  }
  persister.onEvent(ev);   // → SQLite (BenchRunPersistence)
  push(ev);                // → text/event-stream
}
```
  レスポンスは `Content-Type: text/event-stream; charset=utf-8` で配信されます。Web クライアントは `stream.getReader()` + `TextDecoder` で読み取り、`\n\n` で分割し、行ごとに `data:` プレフィックスを剥がし、各ブロックを `JSON.parse` して `StreamEvent` に戻します（`apps/web/src/App.tsx`）。MCP アプリは `BenchClient.postStream`（`apps/mcp/src/bench-client.ts`）と SSE 行パーサ（`apps/mcp/src/sse.ts`）で同一のエンドポイントに到達します。

- **イベント順序（1 回の実行のハッピーパス）。** ジェネレータは決定論的なシーケンスを発行します。単一の `run_started` が完全な `meta` スナップショットを運ぶため、DB とクライアントは単一の信頼できる情報源を共有し、ちょうど 1 つの `run_finished` が実行を閉じます。

| # | `type` | 発生タイミング | 主なフィールド |
|---|--------|---------|------------|
| 1 | `run_started` | 最初に 1 回 | `run_id`, `meta: BenchRunMeta` |
| 2 | `model_loaded` | （任意の `preflight_memory_fit`・`model_unloaded` の後） | `model_id`, `provider` |
| 3 | `scenario_start` | シナリオ × ルート × 反復ごと | `scenario_id`, `api_route`, `system_prompt`, `user_prompt` |
| 4 | `token_delta` | 生成中にストリーム | `scenario_id`, `text`（UI チャンク） |
| 5 | `scenario_end` | シナリオの反復が完了したとき | `metrics { ttft_ms, total_ms, usage_output_tokens, ... }`, `quality` |
| 6 | `metrics_update` | 各シナリオの実行後 | `aggregate { scenario_id, api_route, runs[] }` |
| 7 | `contention_summary` | 競合ガード有効時に 1 回 | `total_iterations_discarded`, `guard_effective`, `abort_reason?` |
| 8 | `run_finished` | 最後に 1 回 | `run_id` |

  注: 完了イベントはコード上 `scenario_finished` ではなく `scenario_end` という名前で、`metrics_update` がシナリオ単位の集計を運びます。

- **エラーは例外ではなくイベント。** ジェネレータは `{ type: "error", layer, code, message, partial? }` を yield します（`layer ∈ "upstream" | "downstream" | "orchestrator"`）。回復可能な箇所ではストリーミングを継続します（例: ある反復での `429` や `upstream_exception` は次の反復へ進む）。致命的な状況は 2 通りで実行を終わらせます。ある種はエラーを yield した直後に即 `return` し（`no_routes`, `load_failed`）、別の種は内部の `fatalStop` フラグを立ててシナリオ／ルートループを抜けるため、実行は最終的な `contention_summary`（有効時）+ `run_finished` に収束します（`contention_max_retries_exceeded`, `provider_or_model_unavailable`, 反復間の待機タイムアウト）。ルートには外側の `catch` もあり、最後に `stream_failed` エラーを push するので、ストリーム途中の throw も型付きイベントとしてクライアントに届きます。
- **インターリーブされたイベントとしての競合ガード。** 反復間のアイドルゲートは、静かにブロックするのではなく一級のストリームイベント（`contention_waiting`, `contention_resumed`, `iteration_discarded`）として表面化します。早期アボート以外のすべてのパスは、`run_finished` の前に単一の最終 `contention_summary` に収束します — 長時間実行される副次条件を隠れた状態ではなく yield されるイベントとしてモデル化する好例です。（唯一の例外は `pre_bench` の待機タイムアウトで、これは独自のインライン `contention_summary` を発行し、`run_finished` なしで `return` します。）

## 2. マルチプロバイダー抽象化

1 つのベンチマークハーネスで、ローカルホストまたはリモートの多数の LLM サーバーを対象にできます。そのために **検出（detection）**・**capability の解決（resolution）**・**ディスパッチ（dispatch）** の 3 つの関心事を分離します。`detectProvider()`（`apps/server/src/detect.ts`）は base URL を順序付きのフォールバックチェーンでプローブし、エンドポイントに `ProviderKind` のタグを付け、`capabilities` オブジェクトを添付します。下流では `resolveBenchApiRoutes()`（`packages/shared/src/bench-api-routes.ts`）がそれらの真偽値を具体的な API ルートのリストに変換し、`runBench()`（`apps/server/src/bench-runner.ts`）がそのリストをループして、各ルートを一致するワイヤーフォーマットのアダプタ（OpenAI chat か Anthropic messages）へディスパッチします。要点は、プロバイダーの同一性（identity）とワイヤー能力（capability）を分離することです。identity はリスト取得やライフサイクルの挙動を選び、capability はリクエスト／ストリームの形式を選びます。このパターンの核心は「どのサーバーか（provider identity）」と「どのリクエスト形式をサポートするか（wire capability）」を分けることです。`detectProvider()` は base URL を正規化した後、3 つのリストエンドポイントを順に試してサーバーを識別し、プロバイダーごとに異なる `capabilities` を添付します。次の段階はプロバイダー名ではなく `capabilities` 真偽値だけを見て実際に実行するルートを決めるので、新しいプロバイダーを追加してもディスパッチロジックは変わりません。

### 検出 → フォールバックチェーン

`detectProvider()` は各リストエンドポイントを順に試し、最初に成功した時点で返します。すべての試行は診断用に `steps[]` に追記されます。3 つすべてが外れた場合は `provider: "manual"` にフォールバックします。

- `${base}/api/v1/models` → `provider: "lm_studio"`（`{ models: [{ key, type, display_name, ... }] }` を期待）
- `${base}/api/tags` → `provider: "ollama"`（`{ models: [{ name, model, size }] }` を期待）
- `${base}/v1/models` → `provider: "openai_compatible"`（`{ data: [{ id }] }` を期待）
- いずれも一致しない → `provider: "manual"`（`models: []` と、算出された `reachability` 状態（`ok` | `partial` | `unreachable`））

`base` はまず `normalizeBaseUrl()` で正規化され、スキームがなければ `http://` を前置し、末尾の OpenAI 形式の `/v1` サフィックスを（`stripOpenAiStyleV1Suffix()` で）取り除きます。これによりハーネスは一貫して `base + /v1/...` を組み立てられます。

```ts
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
// "lm_studio" | "ollama" | "openai_compatible" | "manual"

export async function detectProvider(
  rawBaseUrl: string,
  opts?: { fetchImpl?: FetchLike; apiKey?: string;
           manual?: { provider: ProviderKind; models?: { id: string; label?: string }[] } },
): Promise<DetectResult>;
```

### 解決 → capability オブジェクト

検出された各プロバイダーは `capabilities: { openaiChat: boolean; anthropicMessages: boolean }` を持ちます。LM Studio と Ollama は **固定** の capability 定数を使います（偽のモデルでのプローブが誤解を招く `400`/`404` を返すため、プローブは省略）。`openai_compatible` と `manual` は `probeCapabilities()` によりライブでプローブされます。これは `/v1/chat/completions` と `/v1/messages` にダミーリクエストを POST し、`routeLikelyAvailable(status, body)` を呼びます — `2xx`、404 以外の `4xx`、または本文が `{` で始まる `404` を「ルートが存在する」とみなします。

| プロバイダー | caps の出所 | `openaiChat` | `anthropicMessages` |
|---|---|---|---|
| `lm_studio` | `LM_STUDIO_COMPAT_CAPS`（固定） | `true` | `true` |
| `ollama` | `OLLAMA_COMPAT_CAPS`（固定） | `true` | `false` |
| `openai_compatible` | `probeCapabilities()`（ライブ） | プローブ | プローブ |
| `manual` | `probeCapabilities()`（ライブ） | プローブ | プローブ |

### 解決 → ルートの積集合

`resolveBenchApiRoutes()` は capability の真偽値をルート名にマッピングし、続いて任意で呼び出し側が渡す `restrictTo`（例: `["chat_completions"]` だけを望む perf 専用モード）と積を取ります。積が空になった場合は `restrictTo` を無視して検出済みのフルセットを返します — 「ユーザーをルートゼロの状態に絶対しない」という意図的なフォールバックです。

```ts
export type BenchApiRoute = "chat_completions" | "messages";

export function resolveBenchApiRoutes(
  capabilities: DetectCapabilities,           // { openaiChat, anthropicMessages }
  restrictTo?: readonly BenchApiRoute[] | null,
): BenchApiRoute[] {
  const detected: BenchApiRoute[] = [];
  if (capabilities.openaiChat) detected.push("chat_completions");
  if (capabilities.anthropicMessages) detected.push("messages");
  if (restrictTo?.length) {
    const restricted = detected.filter((r) => restrictTo.includes(r));
    return restricted.length ? restricted : detected; // empty intersection → ignore restrict
  }
  return detected;
}
```

### ディスパッチ → プロバイダーアダプタ

`makeBenchRunMeta()` は解決済みルートを `meta.api_routes` に格納します。`runBench()` はまず空リストをガードし（`code: "no_routes"` の `error` イベントを yield）、その後 `for (const api_route of meta.api_routes)` で反復してルートごとに分岐します:

- `api_route === "chat_completions"` → `openAiChatPostWithUsage()` 経由で `${base}/v1/chat/completions` に POST し、`consumeOpenAiChatStream()` で消費
- `api_route === "messages"` → ヘッダ `anthropic-version: 2023-06-01` 付きで `${base}/v1/messages` に POST し、`consumeAnthropicMessagesStream()` で消費

プロバイダー固有のライフサイクル（モデルの load/unload TTL）は capability ではなく `ProviderKind` に基づいて別途ゲートされます。`providerSupportsLoadTtl()`（`packages/shared/src/provider-kind.ts`）は `lm_studio`（load ペイロードの `ttl`）と `ollama`（`keep_alive`）に対してのみ `true` を返すので、`runBench()` はその 2 つだけに TTL 処理を適用しつつ、共有のルートディスパッチ経路は全プロバイダーで同一に保ちます。

## 3. ストリーミングメトリクス抽出

両プロバイダーアダプタは SSE の `ReadableStream` を逐次的に消費し（`consumeOpenAiChatStream` はバッファを `\n`（行）ごとに、`consumeAnthropicMessagesStream` は `\n\n`（イベントブロック）ごとに分割）、生テキストではなく単一のフラットなメトリクスオブジェクトを返します。コンシューマは *最初* の content/reasoning/tool デルタで `performance.now()` を 1 回だけサンプリングし、HTTP リクエスト開始時に取得した `origin` からの相対で TTFT を求めます。またモデルの出力を 3 つの並行チャネル（`text` / `assistantText` / `reasoningText`）に分離し、推論トークンが採点対象の回答を汚染することなくスループットに算入されるようにします。再利用可能な考え方は、測定（TTFT、トークン推定、切り詰めフラグ、ツール呼び出しの組み立て、破損ガード）をすべてストリームリーダー内で行うことで、どのベンダーの SSE 方言が生成したかによらず、比較可能でプロバイダー非依存な数値を呼び出し側に渡せる、という点です。要点は (1) 最初のデルタでのみ TTFT を刻み、(2) `usageOutputTokens`（プロバイダー報告）を優先し、なければ `approxOutputTokens`（長さベース推定）にフォールバックし、(3) 推論（reasoning/thinking）チャネルを採点用本文と物理的に分離しておくことです。OpenAI 側はここに反復ループの早期終了と tool_call 引数の破損検出まで加えます。ソース: `apps/server/src/openai-stream.ts`, `apps/server/src/anthropic-stream.ts`。

### 最初のデルタでの `performance.now()` による TTFT

- `origin = opts?.requestStartedAt ?? performance.now()` — HTTP 送信側から `requestStartedAt` を渡すことで、TTFT にパース時間だけでなく接続／キュー待ちのレイテンシも含めます。
- 単一の `markTtft()` クロージャは、`ttft === null` の間だけ `ttft = performance.now() - origin` を設定するので、最初のデルタでラッチし、それ以降は冪等です。
- 「最初のトークン」とみなす対象は意図的に選ばれています。OpenAI は `reasoning_content`、文字列 `reasoning`、`content`、`tool_calls` でマークし、Anthropic は `content_block_start`(tool_use)、`input_json_delta`、`thinking_delta`、またはテキストデルタでマークします。純粋なメタデータイベント（usage のみのチャンク、`message_delta`）は TTFT を **マークしません**。
- `totalMs = performance.now() - origin` は読み取りループ終了後に取得します。デルタが 1 つも届かなければ `ttftMs` は `null` のままです。

### `usageOutputTokens ?? approxOutputTokens` による TPS

- プロバイダー自身のカウントを優先します。OpenAI は `stream_options.include_usage` トレーラー（`usage.completion_tokens`、なければ `usage.output_tokens`）から読み、Anthropic は `usage.output_tokens`（`message_delta` イベントに載る累計）または `message.usage.output_tokens` を読みます。いずれも `usageOutputTokens` に格納され、サーバーが省略した場合は `null` のまま（vLLM / LM Studio で一般的）です。
- `approxOutputTokens` はフォールバックの推定値で、`Math.max(0, Math.ceil(outText.length / 4))` — おなじみの約 4 文字/トークンのヒューリスティックです。スループットのコンシューマは `(usageOutputTokens ?? approxOutputTokens) / (totalMs / 1000)` で tokens/sec を計算します。
- 両アダプタは、2 つのプロバイダーが比較可能になるよう推定値に推論トークンを算入します。OpenAI の `outText`（= `combined`）はすでに推論を含みますが、Anthropic は推論を `text` の外に保つため、明示的に足し戻します: `Math.ceil((reasoningText.length + outText.length) / 4)`。

### 推論チャネルの分離: `text` vs `assistantText` vs `reasoningText`

| フィールド | OpenAI ソース | Anthropic ソース | 目的 |
|---|---|---|---|
| `assistantText` | `delta.content` only | `content_block_delta` text only | 採点対象の可視回答; ツールラウンド履歴 |
| `reasoningText` | `delta.reasoning_content` + string `delta.reasoning` | `thinking_delta` | 推論履歴として再注入; 採点から除外 |
| `text` | `combined`（推論 + content、到着順）+ `\n` + シリアライズした `tool_calls` | content テキスト + `\n` + シリアライズした `tool_calls`（推論は **含まない**） | スループットの分母 / `output_text` のベース |

- 採点はクリーンなチャネルを優先するヘルパーを使います。`openAiBenchOutputText` は `assistantText` が非空ならそれを返し、なければ `text` にフォールバックします（最終ターンが推論のみのデルタを出す `reasoning_split` のインターリーブケースを保護）。
- ライブのトークン UI は `openAiLiveTokenStreamText` = `` `${reasoningText}${assistantText}` `` を使うので、推論はストリーム表示されつつも分離可能なままです。

### 切り詰め検出

- OpenAI は最後の非空 `choices[0].finish_reason` を `finishReason` に格納します。`"length"` は `max_tokens` の上限に達した（切り詰め）ことを意味します。Anthropic は `message_delta.delta.stop_reason` を `stopReason` に格納し、`"max_tokens"` が切り詰めのシグナルです。
- どちらのフィールドも、それらを省略する OpenAI 互換サーバーでは `null` になり得るので、`null` は「クリーンな停止」ではなく「不明」として扱います。なお Anthropic はストリームの *完了*（`message_stop` からの `sawMessageDelta`）を *理由* とは別に追跡します。[^oai-compat][^anthropic-stream]

### インデックスによる `tool_call` のマージ

- ストリームされるツール呼び出しは `index` でキー付けされた断片として届き、両アダプタは `Map<number, ...>` に蓄積します。OpenAI の `mergeToolCallDeltas` は各断片を `typeof p.index === "number" ? p.index : 0` でキー付けし、`id`/`type`/`name` があれば上書きし、`function.arguments` の断片は **連結** します。Anthropic は `content_block_start`(tool_use) でエントリを（`j.index ?? 0` でインデックス）シードし、`input_json_delta.partial_json` を `inputJson` に追記します。
- 確定時にエントリはインデックス順にソートされます。Anthropic は各 `inputJson` を `JSON.parse` し（エラー時は `{}` にフォールバック）`AnthropicToolUseOut.input` にします。欠落した id は合成されます（`bench_tool_${index}` / `toolu_bench_${index}`）。

### `repetitionLoopDetected` ガード（OpenAI のみ）

- `opts.loopGuard === true` によるオプトイン。そうでなければ完全にスキップされるので、既存の呼び出し側は挙動／オーバーヘッドを維持します。
- `contentOnly` が ≥ 512 文字増えるたびに `detectRepetitionLoop`（`apps/server/src/repetition-guard.ts`）を実行します — ≥ 600 文字かつ、末尾ブロックの反復または末尾 6 行以上のほぼ同一を必要とする保守的なヒューリスティックです。
- 検出時は `repetitionLoopDetected = true` を設定し、次の `reader.read()` の **前** に `break` し（進行中の読み取りがない → `AbortError` なし）、続いて `reader.cancel()` を呼んでバックエンド接続をクリーンに閉じます。

### `toolCallArgsCorrupted` 検出（OpenAI のみ）

- 注釈専用のシグナル（採点は変えない）で、ストリームされる `arguments` が連結して返る（例: `{}{}` や `{"…"}{"…"}`）LM Studio エンジンプロトコル回帰（lmstudio-bug-tracker #1922）向けです。
- `firstBalancedJsonEnd` は文字列／エスケープを考慮して最初のバランスの取れた JSON 値の末尾を走査し、`toolArgsLookCorrupted` はその後に非空白が残っていれば当該呼び出しをフラグします。空文字列、単一の完全なオブジェクト、切り詰め／不完全な JSON は破損では *ない* と扱います（それらは別のラベルが付きます）。

### メトリクスの型

```ts
export type OpenAiStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;          // combined reasoning+content (+ tool_calls JSON)
  assistantText: string; // delta.content only
  reasoningText: string; // reasoning_content + string reasoning
  toolCalls: OpenAiToolCallOut[] | null;
  streamCompleted: boolean;
  approxOutputTokens: number;   // ceil(text.length / 4)
  usageOutputTokens: number | null; // stream_options.include_usage
  finishReason: string | null;  // "length" => truncated
  repetitionLoopDetected: boolean;
  toolCallArgsCorrupted: boolean;
};

export type AnthropicStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;          // content text (+ tool_calls JSON); reasoning NOT included
  assistantText: string; // content_block_delta text only
  reasoningText: string; // thinking_delta
  toolUses: AnthropicToolUseOut[] | null;
  streamCompleted: boolean;
  approxOutputTokens: number;   // ceil((reasoningText.length + text.length) / 4)
  usageOutputTokens: number | null; // message_delta.usage.output_tokens
  stopReason: string | null;    // "max_tokens" => truncated
};
```

## 4. メモリ適合性プリフライトとOOMガード

モデルの重みを RAM にロードする前に、このハーネスは実際に収まるかを予測し、収まらなければ実行をスキップするか、常駐している他のモデルを追い出します — ハードな OOM（「システムリソース不足」）を、クリーンでログに残る判断に変えます。予測器はモデルの生の `size_bytes` を取り、ランタイム／KV オーバーヘッド係数で膨らませ、空きメモリから固定の OS 安全予約を引いた値と比較します。重要なのは、このゲートは **LM Studio 中心** である点です。必要サイズのシグナルも追い出しの仕組みも LM Studio のローカルモデル API 由来なので、**他のプロバイダー（ホスト型 API、他のローカルランタイム）には同等のプリフライトゲートが存在せず**、このチェックなしで単に実行されます。中核ロジックは `apps/server/src/memory-preflight.ts` にあり、LM Studio 固有のヘルパーは `apps/server/src/lmstudio.ts` にあります。中心的な考え方は「ロードする前に予測する」ことです。サイズが不明な場合は絶対にブロックせず続行（`proceed`）して後方互換を保ち、実際のブロックは `fitPolicy` が明示指定されたときだけ起こります。このゲートは LM Studio のローカルモデル一覧・アンロード API に依存するので、他のプロバイダーには同じ事前チェックが存在しない点に必ず注意してください。

### 調整可能な定数

安全マージンを定義する 2 つの定数（`apps/server/src/memory-preflight.ts` より）:

```ts
/** runtime/KV overhead factor, calibrated to an observed 25.71→28.28GB (~+10%) load. */
export const FIT_OVERHEAD_FACTOR = 1.1;
/** headroom reserved for the OS and other processes (bytes). */
export const FIT_SAFETY_RESERVE_BYTES = 2 * 1024 ** 3; // 2 GiB
```

- `FIT_OVERHEAD_FACTOR` は、ディスク上の重みが実行時のフットプリント（KV キャッシュ、ランタイムバッファ）を過小評価する分を織り込みます。ここでの `1.1` は当て推量ではなく、実測のロードに対して較正した値です — 自分のランタイムに合わせて再較正してください。
- `FIT_SAFETY_RESERVE_BYTES` は、モデル自体が「収まる」場合でもマシンがスラッシングしないよう、一定量の RAM を空けておきます。

### 数値の出どころ（LM Studio ヘルパー）

どちらの入力も LM Studio の `GET /api/v1/models`（`/api/v0/models` にフォールバック）レスポンスから取得し、`lmStudioListModels()` でパースします。`apps/server/src/lmstudio.ts` の 2 つの export ヘルパーが、プリフライトに必要なものを抽出します:

```ts
// Required size: the candidate's on-disk/weights size, or undefined if missing/0.
export function lmStudioModelSizeBytes(
  models: readonly LmStudioListedModel[],
  modelKey: string,
): number | undefined;

// Eviction candidates: every currently-loaded instance EXCEPT the target model,
// with per-instance RAM/VRAM usage.
export function lmStudioResidentInstances(
  models: readonly LmStudioListedModel[],
  excludeKey: string,
): Array<{ modelKey: string; instanceId: string; ramBytes?: number; vramBytes?: number }>;
```

- モデルキーは `baseKey()` で正規化され、`.replace(/:\d+$/, "")` により末尾の数値 `:<N>` サフィックスを取り除くので、ベンチの `modelId` が LM Studio のリスト上の `key` と一致します。
- `lmStudioModelSizeBytes()` はリスト上の `size_bytes` を読みます。それが無ければ `preflightMemoryFit()` は `detect` が報告する `size_bytes` にフォールバックし、両方欠けている場合にのみサイズを不明として扱います。
- `lmStudioResidentInstances()` はローカルの `firstNumberField()` ヘルパーで、順序付きキーのフォールバック（`ram_usage` → `ram` → `ram_bytes`、および `vram_usage` → `vram` → `vram_bytes` の対応版）を使ってインスタンスごとの使用量を読み、monitor-collect の `numberField` 慣例に倣います。これらのインスタンスがハーネスの再取得できる RAM です。各 `instanceId` は `loaded_instances[].id` 由来で — LM Studio 公式の unload ボディが運ぶのと同じ値（`{ "instance_id": "…" }`、`lmStudioUnload()` が POST）です。

### 適合性の計算

`preflightMemoryFit()` は `SystemSnapshot`（`getSystemSnapshot()` → `freeMemBytes` フィールド上の `os.freemem()`、テスト用に注入可能）から空きメモリを読み、次を計算します:

```ts
const requiredWithOverhead = Math.ceil(required * FIT_OVERHEAD_FACTOR);
const willFit          = requiredWithOverhead <= free - FIT_SAFETY_RESERVE_BYTES;
const fitsAfterUnload  = requiredWithOverhead <= free + residentRam - FIT_SAFETY_RESERVE_BYTES;
```

なお、発行されるイベント内の `required_bytes` は **生の** `size_bytes`（オーバーヘッド適用前）です。オーバーヘッドは比較の内部でのみ適用されます。

### FitPolicy の結果

`fitPolicy` は任意の enum — `FitPolicySchema = z.enum(["skip", "unload_other_models"]).optional()`（`packages/shared/src/index.ts` 参照）。`"proceed"` を含むことは決してありません。ポリシー不在は「予測してログするだけ、決してブロックしない」を意味します。返される `FitDecision.action` は次のように解決します:

| 条件 | `fitPolicy` | `action` | 効果 |
|---|---|---|---|
| `required` 不明（`size_bytes` なし） | any | `proceed` | ログのみ、`reason: preflight_skipped` — 決してブロックしない（後方互換） |
| `willFit` が true | any | `proceed` | 通常どおりロード続行 |
| 収まらないが `fitsAfterUnload` かつ常駐あり | `unload_other_models` | `unload_other_models` | 追い出し対象として `residentInstances` を返し、その後ロード |
| 収まらない（またはアンロード後も収まらない） | `skip` または `unload_other_models` | `skip` | OOM ではなく実行をスキップ |
| 収まらない | *未設定* | `proceed` | 「予測: 収まらない可能性あり」の警告イベントを出しつつ続行 |

- この関数は、ポリシーによらず **常に** `PreflightMemoryFitEvent`（フィールド: `model_id`, `required_bytes`, `free_bytes`, `resident_ram_bytes`, `will_fit`, `action`, `reason`, `size_source`）を返すので、何もゲートしない場合でも予測は観測可能です。
- `size_source` は出所を記録します: `"list"`（LM Studio）、`"detect"`（フォールバック）、`"unknown"`。
- `unload_other_models` だけが `residentInstances` を実行可能な追い出しセットとして埋めます。他の結果では空、または参考情報として返します（`skip` 分岐でも `residents` は参考情報として素通しします）。

**再利用の要点。** このパターン — `predict(size × overhead) vs (free − reserve)` を行い、常に判断イベントを発行し、明示的なオプトインポリシーの下でのみゲートしつつ既定では非ブロッキング — は、候補のメモリサイズと常駐セットを報告できる任意のローカルモデルランタイムに転用できます。ここでの具体（`/api/v1/models`、`instance_id` による unload）は LM Studio 固有ですが、プリフライト／OOM ガードの形はプロバイダー非依存です。

## 5. プロバイダーのロード・アンロードとTTL

ローカルモデルバックエンドは、モデルを一定時間メモリに保持させる *方法* が異なります。そこでハーネスはこれを単一の capability チェック `providerSupportsLoadTtl(kind)` の背後でゲートし、TTL をプロバイダーごとに適用します。LM Studio はロード呼び出しに直接 `ttl`（**秒** 単位）を受け付け、アイドル時の自動追い出しを提供します。Ollama は `keep_alive` を使いますが、鋭い注意点があります。ベンチが実際に推論を駆動する OpenAI 互換の `/v1/chat/completions` エンドポイントは **`keep_alive` を無視し、リクエストごとにモデルの寿命をデフォルトの 5 分へ静かにリセットします**（[ollama#11458](https://github.com/ollama/ollama/issues/11458)）。再利用可能な回避策は、望みの TTL を Ollama の *ネイティブ* API 経由で帯域外に 2 回適用することです。1 回は実行前のプリロードとして、もう 1 回は実行後に意図した keep-alive を再表明するためです。`openai_compatible`・`manual` プロバイダーは TTL の概念がなく、値があっても無視されます。[^lms-rest][^ollama-api]

- **Capability ゲート**（`packages/shared/src/provider-kind.ts`）: `providerSupportsLoadTtl(p)` は `"lm_studio"` と `"ollama"` に対してのみ `true` を返します。`false` のとき呼び出し側はすべての TTL ロジックをショートサーキットします。
- **LM Studio**（`apps/server/src/lmstudio.ts`）: `lmStudioLoad(baseUrl, modelKey, { ttlSeconds })` は `{ model, ttl }` を `/api/v1/models/load`（`/api/v0/...` にフォールバック）へ POST します。`ttl` は `ttlSeconds` が有限かつ `> 0` のときだけ含まれ、整数秒に切り捨てられます。これはネイティブの LM Studio フィールドなので、再適用のダンスは不要です。
- **Ollama**（`apps/server/src/ollama.ts`）: `ollamaKeepAliveLoad(baseUrl, model, { ttlSeconds })` は空プロンプト（`prompt: ""`, `stream: false`）で **ネイティブ** の `/api/generate` に POST し、生成せずにモデルをメモリへロードします（レスポンスは `done_reason: "load"`）。TTL は数値と duration の曖昧さを避けるため、明示的な Go duration 文字列として `keep_alive: "<seconds>s"` で送ります。
- **`/v1` リセットの回避策**（`apps/server/src/bench-runner.ts` 参照）: まったく同じ `ollamaKeepAliveLoad` 呼び出しを、(1) 推論の *前* のプリロードとして、(2) ベンチ完了 *後* に再利用します。間に挟まる `/v1/chat/completions` 呼び出しがモデルを 5 分デフォルトに戻してしまうためです。ベンチ後の再適用はベストエフォートです。
- **ベストエフォートのセマンティクス**: `ollamaKeepAliveLoad` は決して throw せず — ネットワーク／上流の失敗は `{ ok: false, status: 0, body }` を返す — ので、不安定な keep-alive が実行を中断させることはありません。大きなモデルのコールドロードは数十秒かかり得るため、寛容な 120 秒のタイムアウト（`OLLAMA_LOAD_TIMEOUT_MS`）を使います。

| プロバイダー | 関数 | エンドポイント | TTL フィールド／形 |
| --- | --- | --- | --- |
| `lm_studio` | `lmStudioLoad` | `POST /api/v1/models/load` | `{ model, ttl }` — `ttl` は **整数秒**、`> 0` でない限り省略 |
| `ollama` | `ollamaKeepAliveLoad` | `POST /api/generate`（ネイティブ） | `{ model, prompt: "", stream: false, keep_alive: "<sec>s" }` |
| `openai_compatible`, `manual` | — | — | 非対応; TTL は無視 |

```ts
// packages/shared/src/provider-kind.ts
export function providerSupportsLoadTtl(p: ProviderKind): boolean {
  return p === "lm_studio" || p === "ollama";
}
```

```ts
// apps/server/src/ollama.ts — native preload that actually honors keep_alive
export async function ollamaKeepAliveLoad(
  baseUrl: string,
  model: string,
  opts: { ttlSeconds: number; fetchImpl?: FetchLike; apiKey?: string },
): Promise<{ ok: boolean; status: number; body: string }> {
  const seconds = Math.floor(opts.ttlSeconds);
  const body = JSON.stringify({ model, prompt: "", stream: false, keep_alive: `${seconds}s` });
  // POST to /api/generate; best-effort (returns { ok:false, status:0 } on failure)
}
```

```json
// Ollama native /api/generate load body — loads without generating
{ "model": "llama3.1:8b", "prompt": "", "stream": false, "keep_alive": "1800s" }
```

**他プロジェクト向けの再利用の要点:** バックエンドがネイティブ API と OpenAI 互換シムの両方を公開している場合、互換エンドポイント上の寿命／keep-alive ヒントが尊重されると仮定してはいけません。「モデルを常駐させる」関心事を、冪等でベストエフォートな 1 つの関数に隔離し、プロバイダー capability の述語の背後でゲートし、実際のワークロードをそれで挟み込む（前にプリロード、後に再表明）ことで、実効 TTL がシムの静かなデフォルトではなく意図どおりになります。

## 6. 競合／汚染ガード

共有 GPU 上でレイテンシとスループットを測るベンチマークは、*他の* 推論が同時に走っていない場合にのみ信頼できます — 外部の生成は TTFT を膨らませ tokens/sec を押し下げ、数値を静かに汚染します。ここでの再利用可能な技術は、単一のプローブを決して信用しない **多信号アイドルゲート** です。GPU 使用率（`nvidia-smi`）、Prometheus `/metrics` のリクエストゲージ（vLLM[^vllm-metrics] / llama.cpp[^llamacpp-server] / TGI[^tgi-metrics]）、`lms ps --json` のアクティビティビュー（LM Studio）、Ollama の `expires_at` の変化を融合します。鍵となる構造的洞察は、*自己* 競合（自分のロードで GPU が点灯すること）を避けるための **2 つのサンプリングモード** です。アイドルサンプラー（`sampleIdle`）は自分のリクエストが in-flight でないときにのみ使い、in-flight サンプラー（`sampleInFlight`）は自分のストリーミング *中* にのみ使って、（自分が起こした）GPU 使用率は無視し、代わりに既知の寄与分 1 を超えるリクエストキューの増分を数えます。これは 3 つのフェーズ — `pre_bench` ゲート、`between_iterations` ゲート、検出時に中断して再測定するバックグラウンドの in-flight モニター — に組み込まれています。`manual` プロバイダーの場合、ガードは自動的に無効化されます（`resolveContentionConfig`）。`apps/server/src/contention-probe.ts` と `apps/server/src/bench-runner.ts` の統合を参照。

- **信号の到達範囲（どこで有効か）:** GPU と `lms ps` はサーバーマシンのローカルでのみ有効（`isTargetOnServerHost(baseUrl)`）。`lms ps` はさらに `provider === "lm_studio"` + `isLmsCliEnabled()` + CLI 有効トグルのときのみ。`/metrics` はネットワークエンドポイントなので、リモート対象（`openai_compatible`/`manual`）でも可能です。非対応サーバーでは `/metrics` が non-OK またはパース不能で一度失敗すると `metricsUnavailable` にラッチされ、再ポーリングしません。
- **アイドル vs in-flight のしきい値:** アイドルモードは `metrics.running >= 1 || metrics.waiting >= 1` なら active とみなして待機します。in-flight モードは自分のリクエスト 1 件を差し引くため `metrics.running >= 2 || metrics.waiting >= 1` を競合基準にします。
- **`effective`（ガードが実際に効いたか）:** `sampleIdle` が GPU/metrics/lms のうち「今まさに演算中」を判定できる信号を 1 つでも観測すれば `hasActiveSignal=true` → ゲートがそれを `effective` に昇格させます。ロード済みの在庫（inventory）は `effective` に寄与せず、アクティブ信号が全く無いときにのみ `inventory_only_no_active_signal`（他のモデルがロードされている）または `no_contention_signal_available` の reason ラベルが残ります。

Prometheus[^prometheus-fmt] パーサは 3 エンジンのゲージを合算します（一致が無ければ `null` = 非対応サーバー）:

```ts
const RUNNING_METRICS = ["vllm:num_requests_running", "llamacpp:requests_processing", "tgi_batch_current_size"];
const WAITING_METRICS = ["vllm:num_requests_waiting", "llamacpp:requests_deferred", "tgi_queue_size"];
export function parsePrometheusRunningWaiting(text: string): { running: number; waiting: number } | null;
```

3 つのプローブのエントリーポイントと設定ノブ（すべて UI 入力から `resolveContentionConfig` でクランプ）:

```ts
interface ContentionProbe {
  sampleIdle(signal?: AbortSignal): Promise<IdleSample>;             // pre_bench / between_iterations gate
  segmentBaseline(signal?: AbortSignal): Promise<InFlightBaseline>;  // snapshot loaded IDs + expires_at
  sampleInFlight(baseline: InFlightBaseline, signal?: AbortSignal): Promise<InFlightSample>; // during our stream
}

type ContentionConfig = {
  enabled: boolean;                 // false for provider "manual"
  pollIntervalMs: number;           // clamp 250..5000,     default 1000
  maxRetriesPerIteration: number;   // clamp 0..5,          default 2
  preBenchTimeoutMs: number;        // clamp 0..600_000,    default 120_000
  betweenIterationTimeoutMs: number;// clamp 0..300_000,    default 30_000
  totalWaitBudgetMs: number;        // clamp 0..1_800_000,  default 300_000 (run-global accumulator)
  gpuUtilThresholdPct: number;      // clamp 1..100,        default 25
  requiredConsecutiveIdle: number;  // clamp 1..5,          default 2 (debounce before resuming)
  serverMetricsEnabled: boolean;    // default true
  lmsCliActivityEnabled: boolean;   // default true
};
```

各信号を、それを消費するフェーズにマッピング:

| 信号 | ソース | アイドルゲート（`sampleIdle`） | in-flight モニター（`sampleInFlight`） |
|---|---|---|---|
| GPU 使用率 | `getGpuSnapshot()` 経由の `nvidia-smi` | `maxUtil > gpuUtilThresholdPct` なら active | **使用しない**（自分のロード） |
| リクエストゲージ | Prometheus `/metrics` | `running≥1 \|\| waiting≥1` | `running≥2 \|\| waiting≥1` |
| LM Studio アクティビティ | `lms ps --json` | いずれかの `generating` または自分の `queued>0` | *外部* モデルの generating、または自分の `queued>0` |
| 新規モデルロード | ロード済みモデル在庫 | トリガーではない; アクティブ信号が無いとき `inventory_only_no_active_signal` のラベルのみ | `baseline.loadedIds` に無い ID → `new_model_loaded` |
| Ollama churn | モデルごとの `expires_at` | — | `expires_at` がベースラインを超えて前進 → `expires_at_advanced`（同一モデルへの外部リクエスト） |

**ゲートループの仕組み。** `runIdleGate` は async generator です。最初のサンプルがアイドルなら即座に返り（`waitedMs: 0`）、ビジーなサンプルはポーリングループに入り、`contention_waiting` イベントを発行（重複排除 — 最初のポーリング時、reason 変化時、または 5 回ごとのポーリングで発行）し、`requiredConsecutiveIdle` 回連続でアイドルサンプルが得られて初めて再開し `contention_resumed` を発行します。タイムアウトと `totalWaitBudgetMs` はループの *内側* で毎ポーリング再チェックされます（入口だけのチェックでは sleep 中の超過を捕捉できません）。成功時は、in-flight モニターが差分を取るための新しい `segmentBaseline()` を返します。

**in-flight モニターのティアダウン競合。** `startInflightMonitor` は **async** な `stop()` を返します。内部の `sampleInFlight` は意図的にティアダウンの abort シグナル *なし* で呼ばれるので、`stopRequested` が既に立っていても in-flight での陽性検出は尊重され、`catch` に飲み込まれません。ポーリング間の *sleep* だけが（別の `AbortController`、`sleepCtrl` 経由で）中断可能で、検出を失うことなくティアダウンを素早く起こせます。検出時は `onDetect(reasons)` を発火し、そのランナーコールバックが `contentionController.abort()` を呼びます。リクエスト自体は結合された `reqSignal = AbortSignal.any([controller.signal, contentionController.signal])`（リクエストタイムアウト OR 競合）を監視しているので、abort が in-flight リクエストをティアダウンします。ランナーはその測定済み反復を破棄し、同じインデックスを `maxRetriesPerIteration` まで再実行します（`iteration_discarded`）。

**最終 `contention_summary`。** 実行ごとにちょうど 1 つの `contention_summary` が発行され（pre-bench アボート時はインライン、それ以外のすべての経路では STEP 7 で）、`updateRunMetaJson`（`apps/server/src/db/persist-stream.ts`）経由で `meta_json` に永続化されます:

```json
{
  "type": "contention_summary",
  "total_iterations_discarded": 2,
  "max_pre_bench_wait_ms": 4000,
  "max_between_iteration_wait_ms": 1200,
  "total_wait_ms": 5200,
  "guard_effective": true,
  "gpu_signal_available": true,
  "abort_reason": "contention_max_retries_exceeded"
}
```

- `guard_effective` / `gpu_signal_available` により、コンシューマは「クリーンな実行でガードが能動的に監視していた」と「ガードは走ったが使える信号が無かった」を区別できます — 異種ホスト間で結果を公開する際に重要です。
- `abort_reason` は `pre_bench_wait_timeout`、`between_iteration_wait_timeout`、`total_wait_budget_exceeded`、`contention_max_retries_exceeded` のいずれかです（クリーンな終了時は不在。`contentionAbortReason` は `string | undefined`）。`contention_max_retries_exceeded` で中断されたシナリオは信頼できないものとして集計が抑制され（`runs.length > 0 && contentionAbortReason !== "contention_max_retries_exceeded"`）、待機タイムアウトによる中断はそれに先行してクリーンに完了した実行を残します。

## 7. ストレスランプとバックプレッシャー

ストレス実行は、離散的な *ステージ*（`start → max` を `step` ずつ）で同時実行数を段階的に引き上げ、各ステージ内で `concurrency` 個の async ワーカーを起動して、固定の `durationMs` のエンキューウィンドウの間、ストリーミングリクエストを連続して発射し、その後 in-flight リクエストをドレインします。ワーカーは結果を直接書き込まず、型付きイベントを有界のインメモリキューに `push` し、外側の async generator がそれらを `yield` します。こうして実行全体が単一の `AsyncGenerator<StressStreamEvent>` となり、トランスポート（SSE/WebSocket）がそれをクライアントへ直接パイプできます。バックプレッシャーは high-water mark で強制されます。キューが埋まると、プロデューサは無制限に確保する代わりにドレイン信号を `await` します。各ステージは、p50/p95 のレイテンシ + TTFT、`aggregate_tps`、`tps_per_user`、`error_rate` を持つコンパクトな `StressStageResult` に集約され、サンプルが信頼するには小さすぎる／短すぎる場合は `tps_unreliable` フラグが付きます。この形は、ライブの進捗をストリームしつつクリーンなステージ単位サマリーも発行する、あらゆる負荷ハーネスで再利用できます。中核の考え方は *プロデューサ（ワーカー）とコンシューマ（ジェネレータ）をキューで分離する* ことです。ワーカーは結果を直接放出せず `queue.push` 後に `wake()` でコンシューマを起こし、コンシューマはキューから 1 つずつ `yield` します。キューが `QUEUE_HIGH_WATER`（256）に達するとワーカーは `awaitDrainIfFull()` で待機し、コンシューマがキューを半分（128）以下に空けると `drainSignal()` で再び起こしてメモリ暴走を防ぎます。`apps/server/src/stress-runner.ts` と `packages/shared/src/stress.ts` を参照。

- **Ramp ループ。** `for (let cc = meta.ramp.start; cc <= meta.ramp.max; cc += meta.ramp.step)` — 同時実行レベルごとに 1 ステージ。`clampRamp()` は入力を `start∈[1,256]`、`max=max(start,…,256)`、`step∈[1,64]`、`durationMs∈[100,600_000]` に制限するので、不正なリクエストが無限または退化したランプを生むことはありません。
- **ワーカープール。** ステージごとに `concurrency` 個のワーカーが `workerPromises[]` に起動されます。各ワーカーはループします: `externalSignal.aborted` と `performance.now() >= enqueueDeadline`（`enqueueDeadline = stageStart + meta.ramp.durationMs`）をチェックし、1 件のストリーミングリクエストを発行し、`WorkerRequestOutcome` を記録し、繰り返します。`401`/`403` はそのワーカーを早期に離脱させます（認証は負荷下で回復しません）。
- **エンキューウィンドウ vs ドレイン。** `durationMs` は *新規* リクエスト開始のみをゲートします。既に in-flight のリクエストは締切後に await されます。ステージは両フェーズを報告します: `enqueue_duration_ms` と `drain_ms`（および合計 `duration_ms`）。
- **バックプレッシャー。** 2 つの one-shot promise リゾルバ — `resolveWait`（コンシューマがイベントを待つ）と `resolveDrain`（プロデューサがキューのドレインを待つ）。これが再利用可能な中核です:

```ts
const queue: StressStreamEvent[] = [];
const QUEUE_HIGH_WATER = 256;
const pushEvent = (ev: StressStreamEvent) => { queue.push(ev); wake(); };
const awaitDrainIfFull = async (): Promise<void> => {
  if (queue.length < QUEUE_HIGH_WATER) return;
  await new Promise<void>((resolve) => { resolveDrain = resolve; });
};
// consumer side, after shift():
if (queue.length < QUEUE_HIGH_WATER / 2) drainSignal();
```

- **レースガード。** コンシューマが `resolveWait` で待機するとき、promise executor の *内側* で `producerFinished || queue.length > 0` を再チェックし、その間にワーカーが push または完了していれば即座に resolve します — lost-wakeup のデッドロックを回避します。
- **ライブティック。** `setInterval`（デフォルト `tickIntervalMs` 1000、最小 250）が、最終集約とは独立に、進行中の `aggregate_tps_so_far` と `succeeded_so_far` を持つ `stress_stage_tick` をライブ UI 向けに発行します。

**ステージ単位の集約。** ステージがドレインした後、成功した結果だけがサマリーに入ります。`p50p95()` は値をソートし、リクエストの `latency_ms`（`totalMs` 由来）と `ttft_ms`（リクエストごとの `ttftMs` 由来、TTFT が 1 つも取れなければ完全に省略）の両方について `floor(q * length)` でインデックス選択します（補間なしの nearest-rank）。

```ts
const elapsedSec = durationMs / 1000;
const aggregateTpsRaw = elapsedSec > 0 ? outputTokensTotal / elapsedSec : null;
const tooFew = successful.length < 5;
const tooShort = durationMs < 3000;
const noSuccess = successful.length === 0;
const tpsUnreliable = noSuccess || tooShort || tooFew;
const aggregateTps = tpsUnreliable ? null : aggregateTpsRaw;
const tpsPerUser = aggregateTps != null ? aggregateTps / concurrency : null;
// error_rate is built inline in the result object:
//   error_rate: requestOutcomes.length > 0 ? failedCount / requestOutcomes.length : 0
```

- **`aggregate_tps` + `tps_unreliable`。** 壁時計のステージ秒数に対する総出力トークン。成功がゼロ、ステージが `< 3000 ms` で走った、または成功が `5` 件未満のときは `null` に抑制され（`tps_unreliable: true` を追加）ます — 小さなサンプルは誤解を招くスループットを生みます。
- **`tps_per_user`。** `aggregate_tps / concurrency` — クライアントごとの取り分で、ランプが上がるにつれ通常劣化するのはこれです。
- **`tps_source`。** `mergeTpsSources()` はリクエストごとのソースを `"usage" | "approx" | "mixed"` に畳み込みます: すべてのリクエストが実トークン使用量を報告したら `usage`、すべてが `approxOutputTokens(text)` にフォールバックしたら `approx`、それ以外は `mixed`。これはスループットが測定値か推定値かを読み手に伝えます。
- **`error_rate`。** *試行* に対する失敗（`requests_attempted - requests_succeeded`）。リクエストが `ok` とカウントされるのは、ストリームが完了した（または非空テキストを生成した）*かつ* `output_tokens > 0` の場合のみです。

**再利用可能なストレスハーネスの形。** コントラクトは `packages/shared/src/stress.ts` にあり、プロバイダー非依存です（ランナーは検出された capability に応じて `chat_completions` か `messages` を選ぶ）。主な型:

| 型 | 目的 | 注目フィールド |
| --- | --- | --- |
| `StressRampConfig` | ランプ入力 | `start`, `max`, `step`, `durationMs` |
| `StressStageResult` | ステージ単位サマリー | `concurrency`, `enqueue_duration_ms`, `drain_ms`, `aggregate_tps`, `tps_per_user`, `tps_unreliable?`, `latency_ms`, `ttft_ms?`, `error_rate`, `tps_source` |
| `StressStreamEvent` | ライブストリームのユニオン | `run_started`, `model_loaded`, `stress_stage_started`, `stress_worker_request_start/token_delta/request_end`, `stress_stage_tick`, `stress_stage_finished`, `run_finished`, `error` |

```ts
export interface StressStageResult {
  stage_index: number;
  concurrency: number;
  duration_ms: number;
  enqueue_duration_ms: number;
  drain_ms: number;
  requests_attempted: number;
  requests_succeeded: number;
  output_tokens_total: number;
  aggregate_tps: number | null;   // null when tps_unreliable
  tps_per_user: number | null;
  tps_unreliable?: true;
  latency_ms: StressStageLatencyMs;        // { p50, p95 } | nulls
  ttft_ms?: StressStageLatencyMs;          // omitted if no TTFT observed
  error_rate: number;
  tps_source: StressTpsSource;             // "usage" | "approx" | "mixed"
  script_match_rate?: number | null;
}
```

ランナーは素の async generator なので、テストは `StressRunnerOptions`（`fetchImpl`, `signal`, `tickIntervalMs`, `maxRequestsPerWorker`）経由で決定論的に駆動できます — 再利用者が上流をモックしたりワーカーのリクエスト数を制限したりするのに注入するのと同じシームです。

## 8. マルチターンエージェントループハーネス

マルチターンのエージェントループハーネスは、実際のツールを一切実行せずに、モデルを N 回のツール呼び出しラウンドにわたって駆動します。すべての `tool_call` は定型の「モック」レスポンスで応答するので、単発の function-calling プローブでは再現できないクロスターンの失敗モード — 空ターンのストール、中間ターンへ漏れる思考、可視の回答が出る前にターンごとのトークンバジェットを使い切る推論 — を再現できます。中核はルート非依存の純粋なリデューサ（`stepAgentLoop`）で、ルート正規化されたターン（`NormalizedTurn`）を消費し、`LoopState` を蓄積し、「このツール結果でループ継続」か「これが最終ターン」かの `StepDecision` を返します。2 つの薄いルートアダプタ（OpenAI `chat_completions` と Anthropic `messages`）が `NormalizedTurn` を構築して同じリデューサに供給するので、ワイヤーフォーマットによらずメトリクスは同一に計算されます。全体はシナリオ上の `agentLoop` ブロックで宣言的に定義され、その存在がシナリオをマルチターンにします。再利用の要点は 2 つです。(1) ツールを実際に実行せず **定型（canned）のモック結果だけを返す** ので、実行環境なしでもマルチターンの挙動を決定論的に観察でき、(2) ターン分析ロジックをルートから分離した **純粋なリデューサ** にすることで OpenAI/Anthropic 両ルートが同一の指標を算出します。`apps/server/src/agent-loop.ts` と `packages/shared/src/scenario-registry.ts` のスキーマを参照。

- **モックのディスパッチ（`pullMock`）**: 通常の `MockTool` では、ハーネスはツールごとの `responses` キュー（`cursor: Map<string,number>`）から次のエントリをポップし、キューが尽きたら `repeatLast` が設定されていれば最後のエントリを繰り返します。ツールが `argDispatch` を定義していれば、レスポンスは代わりに `JSON.parse(args)[argKey]` を `cases` で引いて選ばれるので、モデルは不透明な id を逐語コピーしないとヒットしません — こうして引数の忠実度を測ります。
- **ルートアダプタは正規化するだけ**: `runAgentLoopOpenAi` / `runAgentLoopAnthropic` は `token_delta` イベントをストリームする async generator で、`NormalizedTurn`（可視 `content`、`reasoningText`、`toolCalls`、`usageOutputTokens`、`finishReason`）を構築し、次の反復の前にアシスタントターン + ツール結果をトランスクリプトに追記します。

メトリクスの表面（`apps/server/src/agent-loop.ts` の逐語的な型）:

```ts
export type AgentLoopMetrics = {
  turns_to_completion: number | null;   // null on stall / budget_exhausted
  empty_turn_count: number;             // turns with visible content=="" AND 0 tool_calls
  valid_tool_call_rate: number;         // validToolTurns / turnsExecuted, 0..1
  intermediate_turn_leak: boolean;      // thinking/channel tags leaked into a tool-calling turn
  thinking_exhausted_budget: boolean;   // a turn hit finish_reason=length/max_tokens with empty content
  tool_arg_hits: number | null;         // argDispatch hits; null if no argDispatch tool in scenario
  tool_arg_attempts: number | null;     // argDispatch calls;  null if no argDispatch tool in scenario
  final_turn_output_tokens: number | null; // output tokens of the no-tool final turn; null if never reached
  tool_call_counts: Record<string, number>; // per-tool actual calls (mock-matched only)
  completion_reason: "completed" | "stall" | "budget_exhausted";
};
```

- **`valid_tool_call_rate`** は呼び出し比ではなく *ターン* 比です。ターンが valid とカウントされるのは、`name` がシナリオの宣言済み `def.tools` に含まれ **かつ** `argsJson` が `JSON.parse` を通る（`jsonParses`）ツール呼び出しを少なくとも 1 つ持つ場合です。除数は `turnsExecuted`。
- **`tool_call_counts`** は、ハーネスが構成済みモックに一致させられた呼び出しのみを数え（未宣言のツールは除外）、引数の妥当性では意図的にフィルタ **しません** — シーケンスモックは引数が破損していても「実行」されて消費されるので、フィルタすると本当のリトライを「リトライしなかった」と誤報します。引数の質は `valid_tool_call_rate` と `tool_arg_hits/attempts` で別途測ります。
- **`tool_arg_hits` / `tool_arg_attempts`** は、シナリオに `argDispatch` モックが無いとき `0` ではなく `null` です — `state.argDispatchConfigured` がこれをゲートするので、コンシューマは「未測定」と「測定してヒット 0」を区別できます。下流の忠実度 = `hits / attempts`。
- **`intermediate_turn_leak`** はツール呼び出し（非最終）ターンでのみ発火し、`stripThinkingBlocks(content) !== content.trim()` のとき — すなわち推論／チャネルのマークアップが、クリーンであるべき中間コンテンツに滲み出たときです。

**3 つの `completion_reason` 状態の区別。** ここが肝です。`completed` と `stall` はどちらも、ツール呼び出しの **無い** ターンが到着したときに `stepAgentLoop` が返す *最終ターン* の判定です。`budget_exhausted` は外側のループが返し、リデューサは決して返しません。

| `completion_reason` | 決定される場所 | トリガー | `turns_to_completion` | `final_turn_output_tokens` |
| --- | --- | --- | --- | --- |
| `completed` | `stepAgentLoop`（最終） | ツール呼び出し無し **かつ** 可視コンテンツが非空 | `state.turnsExecuted` | 設定される（最終ターンの usage） |
| `stall` | `stepAgentLoop`（最終） | ツール呼び出し無し **だが** 可視コンテンツが空（`empty_turn_loop:no_signal`） | `null` | 設定される（0 の場合あり） |
| `budget_exhausted` | 外側の generator | `for` ループが `loop.maxTurns` で尽きた（まだツールを要求中）、または上流の HTTP エラー | `null` | `null`（最終ターンに到達せず） |

- 実務上の見分け方は **誰がループを終わらせたか** です。`stall` ではモデルが自発的にツール呼び出しをやめたが使えるものを何も出さなかった（バジェット内で諦めた）。`budget_exhausted` ではモデルがツールラウンドを要求し続け、ハーネスが `maxTurns` で打ち切った — だからツール無しの最終ターンに到達せず `final_turn_output_tokens` は `null` です。
- **`thinking_exhausted_budget` は直交していて — ループがどう終わったかではなく、*なぜ* ターンが空だったかに答えます。** これは、空ターンが `finishReason === "length"`（OpenAI）/ `"max_tokens"`（Anthropic）で終わったとき、または — サーバーが `finishReason` を省略したとき — `usageOutputTokens >= maxTokens` のときに立つスティッキーな boolean です。`stall` とも `budget_exhausted` とも共起し得て、モデルが `reasoning_content` で推論し過ぎて可視コンテンツを出すバジェットを使い切った本番の `empty_turn_loop:no_signal` シグネチャを特定します。

```ts
// stepAgentLoop, final-turn branch (no tool calls this turn):
state.finalTurnUsageTokens = turn.usageOutputTokens;
if (isEmpty) {
  return { kind: "final", reason: "stall", turnsToCompletion: null, ... };
}
return { kind: "final", reason: "completed", turnsToCompletion: state.turnsExecuted, ... };
// vs. after the for-loop falls through at loop.maxTurns:
return finalize(state, "budget_exhausted", null, state.lastVisible, state.lastCombined);
```

モック／ループの型は `packages/shared/src/scenario-registry.ts` で宣言され（`AgentLoopSchema` は `maxTurns` 1–16、`mockTools`、`completion`; `MockToolSchema` は `responses`/`repeatLast`/`argDispatch`）、具体的なシナリオは `packages/shared/src/agent-loop-builtin.ts` にあります。

## 9. 品質採点とLLM-as-judge

品質はシナリオごとに単一のエントリーポイント `scoreScenario(id, output, ctx?)`（`apps/server/src/scenarios.ts`）で採点され、`{ pass, score?, reason?, judge_pending? }` を返します。ほとんどのシナリオは **高速な prefilter**（空出力チェック、正規表現／部分文字列のキュー一致、JSON 形状の検証、スクリプト検出）で決定論的に解決するので、API キーなしでもスコアは再現可能です。主観的なビジョンシナリオ（ミーム説明、ワイヤーフレーム HTML）は prefilter だけを走らせ、その後 `LLM_JUDGE_ENABLED` 環境変数でゲートされた **任意の LLM-as-judge** 呼び出し（Anthropic Messages API に対して）に委譲します。内部の全ルーブリックスコアは共有の `0 / 0.33 / 0.67 / 1` スケールにマッピングされ、**`score >= 0.67`（ルーブリック >= 2）が合格** です。prefilter が通ると暫定スコア（`0.33`、内部ルーブリック 1）と `judge_pending: true` フラグだけを付けて返し、judge が有効なときだけ `bench-runner` がその結果で上書きします。judge が無効なときはスコアが `0.33` で **キャップ** され、`computeQualityScores` がこれを `judge_capped` の caveat として表面化します（無音処理はしません）。本節は要約です。シナリオごとの正式なルーブリックと実行時ルールは、アプリの `/profile` ページとリポジトリの `README.md` にあります。

- **ルーブリック → スコアのマッピング** — 単一のソース `rubricToScore(n: 0 | 1 | 2 | 3)`（`packages/shared/src/scenarios-preview.ts`）で、サーバー・judge・UI が再利用:

  | ルーブリック | スコア | 合格 |
  |--------|-------|------|
  | 3 | `1` | true |
  | 2 | `0.67` | true |
  | 1 | `0.33` | false |
  | 0 | `0` | false |

- **高速 prefilter（決定論的、API キー不要）** — 例: `scoreChatMinimal` は空出力で不合格。`scoreVisionMemeExplain` は 4 つの正規表現キュー（`/[가-힣]/`、サーバー/ロバ/コントラストのキュー正規表現）すべてを要求。`scoreVisionWireframe` は HTML フェンス + N 個のセマンティックタグ + 必須の部分文字列キューを要求。構造化シナリオは `extractFirstJsonObject` + Zod で検証。`detectScript` は言語忠実度ラベル向けに `ko | ja | latin | mixed | unknown` を分類します。

- **`judge_pending` の受け渡し** — prefilter が通っても judge が必要な場合、`scoreScenario` は暫定の `score: 0.33` + `judge_pending: true` を返します。`apps/server/src/bench-runner.ts` は `isJudgeEnabled() && quality.judge_pending === true` のときだけ judge を呼び、その後 **SSE/DB 発行の前に内部フラグを剥がす**（`const { judge_pending: _drop, ...rest } = quality`）ので、下流には決して漏れません。

- **`stripThinkingBlocks(text)`**（`packages/shared/src/llm-profiles.ts`） — `<think>` 形式の推論スパンと Gemma の孤立思考プレフィックスを除去し、トリムします。コード／ビジョン／テキストの採点前に呼ばれ、推論アーティファクトがルーブリックを汚染しないようにします。また `apps/server/src/bench-runner.ts` のローカルな `channelTagLeak` チェック（`stripThinkingBlocks(visibleText) !== visibleText.trim()`）も駆動し、可視出力に残る `<think>`/`<|channel|>` タグをフラグします（兄弟の `emptyResponse` チェックは別で、このヘルパーは使いません）。

- **LLM-as-judge 呼び出し** — `runLlmJudge`（`apps/server/src/judge.ts`）は `https://api.anthropic.com/v1/messages` に `temperature: 0`、`max_tokens: 256`、30 秒の abort タイムアウト（`LLM_JUDGE_TIMEOUT_MS`）、**リトライなし**（`LLM_JUDGE_MAX_RETRIES` は `0`）で POST します。モデルは `DEFAULT_LLM_JUDGE_MODEL`（`"claude-opus-4-7"`）がデフォルトで、`LLM_JUDGE_MODEL` で上書き可能。`ANTHROPIC_API_KEY` が必要です。ビジョンリクエストは base64 の `image` ブロックを前置します。judge は JSON のみで返すよう求められ、最初の JSON オブジェクトが `extractFirstJsonObject` でパースされます。

```ts
// apps/server/src/judge.ts
export type JudgeRequest = {
  image?: { bytes: Buffer; mediaType: "image/jpeg" }; // omit → text/artifact judge
  modelOutput: string;
  criterion: string;
  scale?: "binary" | "0-3";        // default "0-3"
  model?: string;
  fetchImpl?: typeof fetch;        // test/proxy injection
};

export type JudgeResult =
  | { enabled: false }
  | { enabled: true; rubric: number; reason: string }
  | { enabled: true; error: "judge_timeout" | "judge_parse_error" | "judge_network_error"; reason: string };

export function isJudgeEnabled(): boolean; // LLM_JUDGE_ENABLED in {1,true,yes}
export async function runLlmJudge(req: JudgeRequest): Promise<JudgeResult>;
```

```bash
# enable the optional judge
export LLM_JUDGE_ENABLED=1
export ANTHROPIC_API_KEY=sk-ant-...
# optional override; default is claude-opus-4-7
export LLM_JUDGE_MODEL=claude-opus-4-7
```

- **再利用パターン。** 安価な決定論的 prefilter をデフォルト経路として保ち、LLM judge はオプトインで fail-soft なオーバーレイとして扱います: 暫定スコア + `*_pending` フラグ、厳格な env ゲート、有界の単一呼び出し（temp 0、タイムアウト、リトライなし）、そして集約スコアで静かに落とすのではなく明示的な「キャップ／未カバー」の caveat を表面化（`packages/shared/src/scoring/quality-score.ts`）。完全なルーブリックカタログは `/profile` と `README.md` を参照。

## 10. 実行の永続化と回帰検出

ベンチ実行はローカルの SQLite ファイル（Node 組み込みの `node:sqlite`[^node-sqlite] `DatabaseSync`、外部ドライバなし）に永続化されるので、履歴・スコアボード・A/B 比較がプロセス再起動をまたいで残ります。単一の接続を遅延的に開き、プロセス寿命の間キャッシュします。ファイルを開けない場合はハーネスは優雅に劣化します（履歴／永続化は無効、ベンチは引き続き走る）。ライブのストリーミングイベントは小さなステートマシン（`start` → `onEvent` → `finalize`）で行に逐次畳み込まれ、回帰検出は 2 つの永続化された実行詳細に対する **純粋関数** なので、DB なしでサーバー側でもテストでも再利用できます。再利用パターン: 書き込みヘルパーをテーブルごとに薄く型付けし、DB を任意扱いし、差分ロジックを副作用なし・しきい値駆動にすること。DB 接続は `tryOpenProdBenchDatabase()` が成功時にプロセス全体で再利用し、失敗時は `null` を返してベンチは継続しつつ履歴 API だけ無効化します（直近の失敗後 `PROD_DB_RETRY_AFTER_MS = 60_000` ms の間はファイル I/O を節約するため即 `null`）。回帰判定（`computeCompare`）は DB に依存しない純粋関数なので、サーバールートでも単体テストでも同じ結果を出します。

### SQLite 永続化（persistence）

- 接続セットアップは `apps/server/src/db/database.ts` にあります: `openBenchDatabase()` は親ディレクトリに `mkdirSync` し、`PRAGMA journal_mode = WAL` + `PRAGMA foreign_keys = ON` を実行し、`migrate()` を走らせます。優雅なシャットダウン時、`closeProdBenchDatabase()` は `db.close()` の前に `PRAGMA wal_checkpoint(TRUNCATE)` を実行します。
- スキーマは冪等です: 全テーブルは `CREATE TABLE IF NOT EXISTS`、加えて `schema_migrations` のバージョン行と、単一のベストエフォートな `ALTER TABLE bench_scenarios ADD COLUMN prompt_system_preview` ガード（`PRAGMA table_info` で確認）。すべての子テーブルは `FOREIGN KEY (run_id) ... ON DELETE CASCADE` を使うので、実行を削除すると scenarios/logs/stages がクリーンアップされます。
- `apps/server/src/db/` 配下のクエリヘルパーファイル（正確な名前）:

| ファイル | 役割 |
| --- | --- |
| `apps/server/src/db/database.ts` | 接続の open/close/cache、`migrate()`、全行の insert/upsert/finish/list ヘルパー（`insertRun`, `upsertScenarioAggregate`, `finishRun`, `latestFinishedRunsByModels`, …） |
| `apps/server/src/db/run-queries.ts` | 読み取り側の再構成: `benchResultFromDb()` / `benchResultDetailFromDb()` が実行を再水和（meta + シナリオごとの `runs` + プロンプトプレビュー） |
| `apps/server/src/db/persist-stream.ts` | `BenchRunPersistence` — ライブベンチ中に `StreamEvent` を `bench_*` 行へ畳み込む |
| `apps/server/src/db/stress-persist-stream.ts` | `StressRunPersistence` — ストレス実行向けの同パターン（`stress_runs` / `stress_stages`） |

- `database.ts` の `migrate()` が作るテーブル:

| テーブル | 粒度 | 主なカラム |
| --- | --- | --- |
| `bench_runs` | 実行ごとに 1 行 | `run_id` PK、`status`（`running`/`ok`/`partial`/`error`）、`meta_json`、`error_code`/`error_message` |
| `bench_scenarios` | run × scenario × route | PK `(run_id, scenario_id, api_route)`、`aggregate_json`、`prompt_preview`、`prompt_system_preview` |
| `bench_text_logs` | 追記のみのログ行 | PK `(run_id, seq)`、`ts`、`line`（4000 文字に切り詰め） |
| `stress_runs` / `stress_stages` | ストレス実行 / 同時実行数ごとのステージ | `stress_stages` PK `(run_id, stage_index)` |
| `custom_scenarios` | ユーザー定義シナリオ定義 | `id` PK、`def_json`、upsert |
| `schema_migrations` | バージョン台帳 | 単調増加で挿入される `version` 行 |

- コピーする価値のある 2 つの書き込みパターン: `upsertScenarioAggregate()` は `ON CONFLICT ... DO UPDATE` に `COALESCE(excluded.x, bench_scenarios.x)` を使うので、後のイベントが先のプロンプトプレビューを null で潰しません。`finishRun()` も `error_code`/`error_message` を `COALESCE` するので、実行途中の `markRunErrorPartial()` の原因が実行終了時に消えません。

### persist-stream ライフサイクル（start → onEvent → finalize）

`BenchRunPersistence`（`apps/server/src/db/persist-stream.ts`）は `DatabaseSync | null` で構築されます — 各メソッドは DB が無いとき早期リターンするので、呼び出し側は永続化が有効かどうかで分岐しません。

```ts
class BenchRunPersistence {
  constructor(private readonly db: DatabaseSync | null) {}
  start(meta: BenchRunMeta): void;   // INSERT bench_runs, status="running"
  onEvent(ev: StreamEvent): void;    // fold each event into rows + text log
  finalize(): void;                  // finishRun(status = hadError ? "partial" : "ok")
}
```

- `start(meta)` は `insertRun()` を `status: "running"` で呼び（`meta.base_url.replace(/\/+$/, "")` で末尾スラッシュを剥がして `base_url` を正規化）、インメモリ状態（`logSeq`、プロンプトキャッシュ、`hadError`）をリセットします。
- `onEvent(ev)` は `ev.type` で分岐します:
  - `scenario_start` → `user_prompt` / `system_prompt` を `` `${scenario_id}|${api_route}` `` でキャッシュ（`chat_completions` / `messages` のみ）し、後の集計行が実際の動的プロンプトを得られるようにします。
  - `metrics_update` → `upsertScenarioAggregate()` が `aggregate_json = JSON.stringify(agg)` とキャッシュ済み（または静的フォールバックの）プロンプトプレビューを書き込みます。
  - `error` → `hadError = true` を設定し `markRunErrorPartial()`（`running` → `partial` に反転、code/message を記録）。
  - `contention_summary` / `preflight_memory_fit` → `updateRunMetaJson()` がイベント（`type` を除く）を `meta_json` に浅くマージします。これらは実行が始まってからしか分からないためです。
  - ほとんどのイベントは `appendTextLog()` で人間可読な行も追記します。
- `finalize()` は、何らかのエラーが見られたら `partial`、そうでなければ `ok` で `finishRun()` を呼び、状態をクリアします。なおメソッド名は `finish()` ではなく `finalize()` です。

### 回帰比較（`/api/v1/compare`）

このルート（`apps/server/src/catalog-routes.ts` の `app.get(\`${prefix}/compare\`)`、`/api` と `/api/v1` の両方にマウント）は、`runA`&`runB` または `modelA`&`modelB`&`baseUrl`（モデルごとの最新完了実行を `latestFinishedRunsByModels()` で取得）のいずれかを受け付け、両側を `benchResultDetailFromDb()` で再水和し、`packages/shared/src/scoring/compare.ts` の純粋な `computeCompare()` を呼びます。しきい値の上書きはクエリパラメータで届き、寛容にパースされます（`numQ`/`boolQ`）。

- 実行は `` `${id} ${api_route}` ``（`joinKey` ヘルパー）で結合され、**両側** で `runs.length > 0` を持つシナリオのみが比較されます。各側は `SideMetrics` に集約され、各メトリクスは `MetricDelta` として発行されます:

```ts
type MetricDelta = { a: number|null; b: number|null; delta: number|null; pct: number|null };
// delta = b - a  (null if either side null); pct = (b - a) / a (null if a is 0/null)
```

- シナリオごとに発行されるデルタ: `ttft_p50`、`ttft_p95`（nearest-rank パーセンタイル）、`tps_per_user`（実行ごと TPS の平均）、`tps_aggregate`（Σtokens / Σseconds）、`quality`（スコア平均）、`empty_turn_rate`、`channel_tag_leak`。
- 回帰シグナルの型（`RegressionKind`）と正確なルール — 方向が重要で、TPS は **aggregate** メトリクスを、TTFT は **p95 のみ** を使う点に注意:

| `RegressionKind` | しきい値キー（デフォルト） | 発火条件 |
| --- | --- | --- |
| `quality_drop` | `qualityDropAbs` (0.05) | `a.quality - b.quality > qualityDropAbs`（絶対値の低下） |
| `tps_regression` | `tpsRegressionPct` (0.15) | `b.tps_aggregate < a.tps_aggregate * (1 - tpsRegressionPct)` |
| `ttft_regression` | `ttftRegressionPct` (0.25) | `b.ttft_p95 > a.ttft_p95 * (1 + ttftRegressionPct)` |
| `new_empty_turns` | `flagNewEmptyTurns` (true) | `a.empty_turn_rate === 0 && b.empty_turn_rate > 0` |

- シナリオの `regression` boolean は `regressions.length > 0`。トップレベルの `summary` は `regression`、和集合の `regressions`、`scenarios_regressed`、`scenarios_compared` をまとめます。デフォルトは `CompareThresholdsSchema` に一度だけ宣言され（Zod `.default(...)`）、`CompareThresholdsSchema.parse(thresholdsInput ?? {})` で適用されるので、空の上書きオブジェクトでも正規のしきい値になります — API のデフォルトと検証を一箇所に保つクリーンな方法です。

## 11. プロバイダーの落とし穴

ローカルの **LM Studio** バックエンドを駆動するとき、2 つの失敗モードが HTTP エラーを一切 throw せずにスコアを静かに汚染し得ます。どちらも、あなたのハーネスではなく特定のアプリビルド／GGUF テンプレートに依存します。以下の 2 つのドキュメントを正典として扱い、内容を複製するのではなく単一の信頼できる情報源として保ってリンクしてください。バージョンのタイムラインや根本原因の分析は、LM Studio が新しいエンジンビルドを出すたびにドリフトするためです。アプリ内では、影響を受ける各結果行が `apps/web/src/components/ResultsTable.tsx` で `⚠` バッジ付きにマークされます。バッジのツールチップはオペレーターに行を開くよう促し、行の詳細ドロワー（`apps/web/src/components/ScenarioDetailDrawer.tsx`）とテーブル凡例が、オペレーター向け是正のための `/profile#lmstudio-host` へのディープリンクを持ちます。ここでの再利用可能なパターンは **注釈専用の検出** です: 破損を実行レコードにフラグし、合否判定はそのままにし、人間をバージョン付きの修正ページへ誘導します。LM Studio はどちらの場合も 200 応答を正常として返すため、ハーネスは例外として捕捉できません。バッジ自体はリンクではなくアイコンで、是正案内 `/profile#lmstudio-host` のリンクは行の詳細ドロワー（`ScenarioDetailDrawer.tsx`）と結果表の凡例（`ResultsTable.tsx`）に入っています（アンカーは Web の `ProfileDocPage.tsx` の `id="lmstudio-host"`）。

- **エンジンプロトコル回帰（ツール引数の破損 + 推論リーク）。** 症状: *「Use LM Studio Engine Protocol」* を on にすると（ビルド ~0.4.14–0.4.18）、ストリームされる `tool_calls[].function.arguments` が `{}{}{}` のように連結して返り[^lms-1922]、下流の `JSON.parse` が失敗してツールシナリオが静かに 0 点になります。別途、推論が `reasoning_content` ではなくレスポンス `content` に再生され、採点テキストを汚染します。回避策: LM Studio **0.4.19+** に固定する（両方修正済み）か、オプションをオフにする。`⚠` バッジ **`tool_call_args_corrupted`** と **`reasoning_leaked_into_content`** として検出されます。ドキュメント: [`docs/lmstudio-engine-protocol.md`](docs/lmstudio-engine-protocol.md) · アプリ内: `/profile#lmstudio-host`。
- **Jinja テンプレートのクラッシュ（Anthropic `/v1/messages` + `tools`）。** 症状: tools 付きの Anthropic messages ルートでのみ、モデル組み込みの Jinja `chat_template` が OpenAI 形状の前提でレンダリングされて `UndefinedValue` に当たり、実行が空で終わります（`Response finished but empty`）。同じモデルの OpenAI `/v1/chat/completions` ルートは正常にレンダリングされることが多いです。回避策: 修正済みの GGUF を再ダウンロードする、かつ／または LM Studio を更新する、あるいはホスト側のテンプレート上書きスクリプト（`scripts/fix-nemotron-lmstudio-template.sh`, `scripts/fix-gemma4-lmstudio-template.sh`、まず `--dry-run` で実行）を適用する。ドキュメント: [`docs/lmstudio-jinja-template-crashes.md`](docs/lmstudio-jinja-template-crashes.md) · アプリ内: `/profile#lmstudio-host`。

2 つのバッジは別々の検出箇所に対応するので、このパターンを再利用する際は分けて保ってください:

| バッジフラグ | 発生箇所 | 捕捉するシグネチャ |
|---|---|---|
| `tool_call_args_corrupted` | `apps/server/src/bench-runner.ts`（`apps/server/src/openai-stream.ts` のストリームマージ中に計算される `toolCallArgsCorrupted` メトリクスから集約） | 完全な JSON の後に別の JSON が続くマージ済みツール呼び出し引数（`{}{}`） |
| `reasoning_leaked_into_content` | `apps/server/src/bench-runner.ts` | `chat_completions` ルートで、別の推論チャネルが空のときに thinking ブロックのマーカーが `content` に残る |

両フラグは `packages/shared/src/index.ts` の実行スキーマ上の任意の boolean で（それぞれ `z.boolean().optional()` で宣言）、`apps/web/src/components/ResultsTable.tsx` はいずれかが立つとシナリオの隣に `⚠` をレンダリングします:

```ts
// apps/web/src/components/ResultsTable.tsx
const corrupted = r.tool_call_args_corrupted === true;
// channel_tag_leak_detected is the generalized (route-agnostic) signal;
// fall back to the legacy reasoning_leaked_into_content for older runs.
const leaked =
  r.channel_tag_leak_detected === true ||
  r.reasoning_leaked_into_content === true;
```

再利用の要点: プロバイダーが `200 OK` を返しつつ出力を破損させ得る場合、**実行を不合格にするのではなく注釈する** — シグネチャごとに名前付き boolean を付け、採点はそのままにし、結果 UI でバッジ表示し、オペレーターを単一のバージョン付き是正ページ（ここでは `/profile#lmstudio-host`）へ誘導して、ハーネスではなく環境を直してもらいます。

## 12. 再利用の方法（チェックリスト）

このハーネスの各技術は、単独で取り出せる 1 つの小さな、ほぼ純粋なエントリモジュールの背後にあります — ほとんどは `fetchImpl` かつ／または `signal` を取り、素のデータか `AsyncGenerator` を返し、フレームワークの糊を避けます。下の「これが欲しい? ここから」マップで、パターンを担うファイルと export シンボルへ直行し、まずその 1 関数のシグネチャと doc コメントを読み、コラボレーターが必要なときだけ import を辿ってください。ストリーミング・検出・比較の中核は HTTP レイヤーや SQLite に依存しないので、別のサーバーや CLI にきれいに移植できます。共通の慣例を知っておくと移植が速くなります。ほとんどのエントリ関数は `fetchImpl?: typeof fetch`（テスト注入・プロキシ差し替え用）と `signal?: AbortSignal`（キャンセル）を取ります。`performance.now()` 基準のタイミングは `requestStartedAt` を渡して「HTTP 送信時点」にアンカリングします（リトライやキュー待ちまで含めたいなら、この値を外側でキャプチャ）。

| これが欲しい… | ここから（リポジトリ相対） | エントリシンボル |
|---|---|---|
| ストリーミングメトリクス（TTFT/TPS、ツール呼び出しマージ、切り詰め／ループフラグ） | `apps/server/src/openai-stream.ts`（Anthropic の双子: `apps/server/src/anthropic-stream.ts`） | `consumeOpenAiChatStream()` |
| プロバイダー抽象化（自動検出 + capability プローブ） | `apps/server/src/detect.ts` | `detectProvider()` |
| 競合ガード（ビジーな GPU をベンチしない） | `apps/server/src/contention-probe.ts` | `makeContentionProbe()`, `runIdleGate()` |
| 負荷／ストレスランプ（同時実行スイープ、バックプレッシャー付きイベントストリーム） | `apps/server/src/stress-runner.ts` | `runStress()` |
| マルチターンエージェントループ（モックツールハーネス、ターン単位メトリクス） | `apps/server/src/agent-loop.ts` | `runAgentLoopOpenAi()` / `runAgentLoopAnthropic()` |
| 永続化 + 回帰差分 | `apps/server/src/db/` + `packages/shared/src/scoring/compare.ts` | `tryOpenProdBenchDatabase()`, `BenchRunPersistence`, `computeCompare()` |

**ストリーミングメトリクス — `openai-stream.ts`。** 単一の SSE リーダーで 1 つのフラットなメトリクスオブジェクトを yield する `consumeOpenAiChatStream` をコピーしてください。各フィールドの doc コメントが仕様です。

```ts
export async function consumeOpenAiChatStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
  opts?: { onDelta?: (d: OpenAiStreamDelta) => void; loopGuard?: boolean; requestStartedAt?: number },
): Promise<OpenAiStreamMetrics>; // { ttftMs, totalMs, text, assistantText, reasoningText, toolCalls,
                                 //   streamCompleted, approxOutputTokens, usageOutputTokens, finishReason,
                                 //   repetitionLoopDetected, toolCallArgsCorrupted }
```

- TTFT は **最初** の content / `reasoning_content` / ツール呼び出しデルタで `markTtft()` により、`requestStartedAt ?? performance.now()` を基準に刻印されます。
- ストリームは 2 つのトークンカウントを返します: `usageOutputTokens` — `usage.completion_tokens`（なければ `usage.output_tokens`）由来のプロバイダー usage で、`stream_options.include_usage` が必要、なければ `null` — と `approxOutputTokens`、常に計算される `text.length / 4` 推定。呼び出し側は usage を優先し `/ 4` 近似にフォールバックするので、TPS はソースについて正直です（`tps_source: "usage" | "approx"`）。
- 注釈専用のシグナル（切り詰めの `finishReason === "length"`、連結 `{}{}` ランタイムバグの `toolCallArgsCorrupted`）は採点を決して変えず、結果にラベルを付けるだけです。

**プロバイダー抽象化 — `detect.ts`。** `detectProvider(rawBaseUrl, opts)` は base URL を正規化し、ネイティブのリストエンドポイントを順にプローブします（LM Studio `/api/v1/models` → Ollama `/api/tags` → OpenAI `/v1/models`）。LM Studio と Ollama のヒットには固定の `capabilities`（`LM_STUDIO_COMPAT_CAPS` / `OLLAMA_COMPAT_CAPS`）が付き、OpenAI 互換と `manual` のフォールスルーは `probeCapabilities` を呼び、使い捨ての `probe-model` を `/v1/chat/completions` と `/v1/messages` に POST します。返される `capabilities: { openaiChat, anthropicMessages }` を、下流の全ランナーがルート選択に使うので（`stress-runner.ts` の `pickRoute()`、ベンチランナーの `resolveBenchApiRoutes()`）、呼び出しごとに散らばった分岐ではなく 1 つの検出結果を得られます。

- ルート可用性のヒューリスティック `routeLikelyAvailable(status, body)` は、不正モデルの `4xx`（または JSON 本文付きの `404`）を「ルートが存在する」と扱います — 「エンドポイント不在」と「エンドポイント存在、リクエストが誤り」を見分けるのに拝借してください。

**競合ガード — `contention-probe.ts`。** 再利用可能な考え方は、自分のロードが競合として読まれないよう 2 つの **別々のサンプリングモード** を持つことです: `sampleIdle()`（in-flight が何も無いときだけ呼ぶ; GPU util + `/metrics` + `lms ps` を信頼）と `sampleInFlight(baseline)`（自分のリクエスト中; GPU ノイズを無視し、`running>=2 / waiting>=1`、モデルロードの churn、Ollama `expires_at` の前進を監視）。`requiredConsecutiveIdle` 回のクリーンなポーリングを待ってから進む `AsyncGenerator<StreamEvent, GateResult>` の `runIdleGate()` と、バックグラウンド検出用の `startInflightMonitor()` で駆動します。`parsePrometheusRunningWaiting()` は単独で取り出せる vLLM/llama.cpp/TGI ゲージパーサです。

**負荷／ストレスランプ — `stress-runner.ts`。** `runStress()` は同時実行を `ramp.start` から `ramp.max` へ `ramp.step` ずつスイープし、`durationMs` が経過するまでリクエストを再発射する `concurrency` 個のワーカーを走らせます。コピーする価値: 無制限のメモリなしにリクエスト単位イベントをストリームする、有界のプロデューサ／コンシューマキュー（`QUEUE_HIGH_WATER = 256` と `awaitDrainIfFull`）と、**信頼性ゲート** — ステージが `< 5` 成功、`< 3000ms` 実行、または成功ゼロのとき `tps_unreliable` を立てる（`aggregate_tps` を null にする）。

**マルチターンエージェントループ — `agent-loop.ts`。** 定型のツール結果を供給する（`pullMock`、不透明 id の忠実度用に任意の `argDispatch`）モックツールハーネスで、単発では隠れるマルチターンの失敗モードを測れます。ルート非依存の中核 `stepAgentLoop(turn, def, loop, state, cursor, maxTokens)` は純粋（I/O なし; 各ターンを渡された `state` に畳み込む）で、`finalize()` がその `state` を `AgentLoopMetrics` — `empty_turn_count`、`valid_tool_call_rate`、`intermediate_turn_leak`、`thinking_exhausted_budget`、`tool_arg_hits`/`tool_arg_attempts`、`final_turn_output_tokens`、`completion_reason` — にレンダリングし、トランスポートから独立して再利用できます。

**永続化 + 回帰 — `db/` + `compare.ts`。** `tryOpenProdBenchDatabase()` は `node:sqlite`（`DatabaseSync`、WAL、FK on）を開き、ファイルが開けないときは throw せず `null` を返すので、ベンチは履歴無効で走り続けます。`BenchRunPersistence` / `StressRunPersistence` は同じ SSE イベントストリーム（`start`/`onEvent`/`finalize`）を消費して書き込みます。回帰ゲート用に、`computeCompare()` は `(scenario, api_route)` で結合してシナリオ単位のデルタを発行する純粋な `(detailA, detailB, thresholds) => CompareResponse` です。

```ts
export const CompareThresholdsSchema = z.object({
  qualityDropAbs:    z.number().default(0.05),  // abs quality drop → regression
  tpsRegressionPct:  z.number().default(0.15),  // aggregate TPS drop fraction
  ttftRegressionPct: z.number().default(0.25),  // TTFT p95 increase fraction
  flagNewEmptyTurns: z.boolean().default(true), // empty turns newly appearing in B
});
```

- `llm-bench-compare` CLI（`apps/mcp/src/compare-cli.ts`、`--fail-on-regression` / `--webhook`）で CI にヘッドレス配線できます。しきい値は Zod 検証されるので、呼び出し側は任意のサブセットを上書きできます。

---

## 付録 A. 用語集

この文書全体で使われる用語を、それを詳しく説明するセクションごとにまとめました。コード識別子は英語のままです。各グループの見出しは、詳説する本文セクションへのリンクです。

### 計測 — [§3](#3-ストリーミングメトリクス抽出)

| 用語 | 定義 |
|---|---|
| TTFT | Time To First Token — 要求送信から最初の content / `reasoning_content` / ツール呼び出しデルタまでの ms。 |
| TPS | Tokens Per Second — 出力トークン ÷ 経過時間。`aggregate_tps` はステージを合算、`tps_per_user` = aggregate ÷ 同時実行数。 |
| `approxOutputTokens` | サーバーが usage カウントを省略したときに使うフォールバックのトークン推定（約 len/4）。 |
| p50 / p95 | ステージ内のレイテンシ（または TTFT）の中央値 / 95 パーセンタイル。 |
| warmup vs measured | warmup 実行はキャッシュを温めて破棄され、measured 実行がメトリクスに入る。 |
| truncation | トークン上限での出力切り詰め — `finish_reason:"length"`（OpenAI）/ `stop_reason:"max_tokens"`（Anthropic）。 |

### 実行モデル — [§1](#1-アーキテクチャとイベントモデル)

| 用語 | 定義 |
|---|---|
| SSE | Server-Sent Events — `data:` フレームの一方向 `text/event-stream`。 |
| `AsyncGenerator` event model | `runBench` が型付きイベントを *yield* し、各コンシューマが自分のトランスポートを選ぶ。 |
| discriminated union | 網羅的な絞り込みのため `type` でキー付けした `StreamEvent` のユニオン。 |
| persist-stream lifecycle | `start → onEvent → finalize` がライブイベントを DB 行に畳み込む。 |

### プロバイダー — [§2](#2-マルチプロバイダー抽象化) · [§5](#5-プロバイダーのロードアンロードとttl)

| 用語 | 定義 |
|---|---|
| `ProviderKind` | `lm_studio` / `ollama` / `openai_compatible` / `manual`。 |
| capability | `{ openaiChat, anthropicMessages }` — サーバーがどのワイヤールートをサポートするか。 |
| API route | `chat_completions`（OpenAI）または `messages`（Anthropic）。 |
| TTL / `keep_alive` | 有界のモデル常駐 — LM Studio ロードの `ttl`（秒）vs Ollama の `keep_alive`。 |
| preload | 測定前にモデルをロードするネイティブ API 呼び出し。 |
| resident instance | バックエンドに既にロードされたモデル（`lmStudioResidentInstances`）。 |
| memory-fit preflight | OOM を避けるためロード前に RAM 適合性を予測（`FitPolicy`）。 |

### ガード — [§4](#4-メモリ適合性プリフライトとoomガード) · [§6](#6-競合汚染ガード)

| 用語 | 定義 |
|---|---|
| contention / pollution | TTFT を膨らませ TPS を押し下げる外部の同時推論。 |
| idle gate | N 回連続のアイドルポーリングを要求する `pre_bench` / `between_iterations` / in-flight フェーズ。 |
| `sampleIdle` vs `sampleInFlight` | 自分の負荷を競合と誤読しないための 2 つのサンプリングモード。 |
| repetition loop | 暴走した反復出力、検出して中断。 |
| tool-arg corruption | ストリームされるツール引数が `{}{}{}` のように連結（LM Studio エンジンバグ）。 |
| reasoning leak | 推論が可視 `content` チャネルに再生される。 |

### ストレス・エージェント — [§7](#7-ストレスランプとバックプレッシャー) · [§8](#8-マルチターンエージェントループハーネス)

| 用語 | 定義 |
|---|---|
| ramp | `step` ずつの同時実行スイープ `start → max`、各 `durationMs` 保持。 |
| worker pool | ステージ内でリクエストを再発射する N 個の同時ワーカー。 |
| backpressure | 有界のプロデューサ／コンシューマキュー（`QUEUE_HIGH_WATER`、`awaitDrainIfFull`）。 |
| `tps_unreliable` | 成功 <5、<3s、または出力 0 のときステージにフラグ（`aggregate_tps` を null）。 |
| agent loop / mock tool | 単発では隠れる失敗を露呈させる、定型ツール結果を供給するマルチターンループ。 |
| empty turn | 可視コンテンツを何も生成しなかったターン。 |
| stall vs `budget_exhausted` | ループ終了理由 — 進展なし vs トークンバジェット使い切り。 |
| thinking / reasoning channel | 可視コンテンツと切り離された別の推論ストリーム。 |

### 採点・回帰 — [§9](#9-品質採点とllm-as-judge) · [§10](#10-実行の永続化と回帰検出)

| 用語 | 定義 |
|---|---|
| rubric | スコアスケール `0 / 0.33 / 0.67 / 1`; 合格は `score >= 0.67`。 |
| prefilter | judge の前に走る決定論的チェック（空／正規表現／JSON 形状／スクリプト）。 |
| LLM-as-judge | `LLM_JUDGE_ENABLED` でゲートされる任意の Anthropic-Messages 採点。 |
| `stripThinkingBlocks` | 採点と UI 表示の前にインライン推論を除去。 |
| regression thresholds | `qualityDropAbs` · `tpsRegressionPct` · `ttftRegressionPct` · `flagNewEmptyTurns`。 |
| WAL | 実行 DB が使う SQLite の write-ahead logging モード。 |

## 付録 B. リファレンス

外部の出典は、本文中で根拠となる正確な箇所に脚注として付けており、このページ末尾の番号付きリストにまとまります（各項目に `↩` の戻りリンク付き）。内部参照ドキュメントは以下に整理します。

- [`docs/lmstudio-engine-protocol.md`](docs/lmstudio-engine-protocol.md) — LM Studio エンジンプロトコル回帰（ツール引数の破損・推論リーク）の正典的な診断・解決。
- [`docs/lmstudio-jinja-template-crashes.md`](docs/lmstudio-jinja-template-crashes.md) — Anthropic `/v1/messages` + tools での Jinja テンプレートクラッシュとオーバーライド。
- [`LLM_PROFILE.md`](LLM_PROFILE.md) — モデルファミリー別のサンプリング・コンテキスト・ランタイムルール。
- [`README.md`](README.md) — プロジェクト概要と「ハーネスノウハウ」節。
- Web UI: `/profile`（ファミリー別ルール・`#lmstudio-host` ホスト設定） · `/scenarios`（シナリオカタログ）タブ。

[^mcp-spec]: [Model Context Protocol — Specification](https://modelcontextprotocol.io/specification) — MCP サーバー（`apps/mcp`）が公開するツール・トランスポート仕様。
[^oai-compat]: [LM Studio — OpenAI-compatible Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions) — `/v1/chat/completions` の SSE デルタ（`choices[].delta`）形式。（OpenAI 公式ドキュメントはボットのアクセスを遮断するため、検証可能な互換仕様で代替。）
[^anthropic-stream]: [Anthropic — Messages streaming](https://docs.anthropic.com/en/api/messages-streaming) — `/v1/messages` の SSE イベント（`content_block_delta`・`thinking_delta`・`message_delta`）形式。
[^lms-rest]: [LM Studio — REST API](https://lmstudio.ai/docs/developer/rest) — モデルの load/unload およびロード時の `ttl`（秒）指定。
[^ollama-api]: [Ollama — API](https://docs.ollama.com/api) — `keep_alive` によるモデル常駐時間の指定（ネイティブ `/api/generate`・`/api/chat`）。
[^vllm-metrics]: [vLLM — Production metrics](https://docs.vllm.ai/en/latest/usage/metrics.html) — `vllm:num_requests_running` / `num_requests_waiting` ゲージ。
[^llamacpp-server]: [llama.cpp — server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) — `/metrics` の Prometheus 公開（リクエスト処理ゲージ）。
[^tgi-metrics]: [Hugging Face TGI — Metrics](https://huggingface.co/docs/text-generation-inference/en/reference/metrics) — バッチ・キューのゲージ。
[^prometheus-fmt]: [Prometheus — Exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/) — `/metrics` テキストのパース仕様。
[^node-sqlite]: [Node.js — `node:sqlite`](https://nodejs.org/api/sqlite.html) — 外部ドライバ不要の組み込み `DatabaseSync`。
[^lms-1922]: [LM Studio bug-tracker #1922](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1922) — エンジンプロトコルランタイムでのストリーミング `tool_calls` 引数の破損。
