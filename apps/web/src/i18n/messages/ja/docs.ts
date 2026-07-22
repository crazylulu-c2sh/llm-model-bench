import type { Messages } from "../ko";

// docs — ko와 키가 정확히 일치해야 함(타입이 강제).
export const docs: Messages["docs"] = {
  visionSubcategory: {
    ocr: "OCR",
    count: "カウント",
    chart: "チャート",
    meme: "ミーム",
    wireframe: "ワイヤーフレーム",
  },
  imageAlt: (category, id) => `${category} シナリオのサンプル画像 (${id})`,

  scenarios: {
    heading: "ベンチシナリオドキュメント",
    intro:
      "ベンチ画面のシナリオカードは目的・合格基準のみを要約します。ここでは同じメタデータを拡張フィールドとして展開し、実際のベンチと同じルールで生成される",
    introPreviewTerm: "リクエストプレビュー",
    introTail:
      "（OpenAI/Anthropic のルート別 JSON — メッセージ・ツール・マルチモーダルを含む）を掲載します。ビジョンシナリオは入力画像のサムネイルをクリックすると拡大表示できます。",
    tocAria: "シナリオ目次",
    toc: "目次",
    textGroup: (n) => `テキスト (${n})`,
    visionGroup: (n) => `ビジョン (${n})`,
    agentGroup: (n) => `エージェント (${n})`,
    textSection: "テキストシナリオ",
    visionSection: "ビジョンシナリオ",
    agentSection: "エージェントシナリオ",
    agentIntro:
      "マルチターンのツール使用ループ。単発と違い、複数ターンにわたってツールを呼び出してから最終回答を出す — 空ターンのストール・思考バジェット枯渇・ツール引数の忠実度など、ターンをまたいで初めて表れる欠陥を測定する。すべてのツール応答は mock。",

    purpose: "目的",
    criteria: "合格 / 不合格基準",
    promptNotes: "プロンプト・注入",
    tools: "ツール",
    routes: "API ルート",
    implementation: "採点・実行",
    requestPreview: "プロンプト・リクエストプレビュー",
    previewIntro:
      "サーバーが組み立てる upstream ボディと同じ構造です。`model`・最終 `max_tokens`・プロファイルサンプリングは UI/プロファイルから追加され、ここではメッセージ・ツール・マルチモーダルパートのみを表示します。",
    visionMaxTokensFloor: "ビジョン max_tokens floor",
    enlargeImageAria: (id) => `${id} 画像を拡大`,
    zoom: "拡大",
    noDescription: "登録された説明がありません。",

    agentCriteria: "合格基準",
    agentRoutes: "ルート",
    noMetadata: "登録されたメタデータなし。",
  },

  harness: {
    canonicalLead: "他プロジェクト参考用 · 正本:",
    newWindow: "（新しいウィンドウで開く）",
    tocAria: "このページの目次",
    tocTitle: "このページ",
    backToTop: "トップへ",
    footnoteLabel: "脚注",
  },
};
