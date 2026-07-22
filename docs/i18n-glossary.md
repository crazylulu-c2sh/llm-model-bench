# i18n 용어집 / Terminology Glossary (ko · en · ja)

번역 일관성을 위한 고정 용어표. UI 라벨과 문서 프로즈가 같은 용어를 쓰도록 모든 번역이 이 표를 따른다.
**코드 식별자·모델 ID·시나리오 ID·메트릭 약어(TTFT/TPS/p50/p95 등)·브랜드명은 번역하지 않는다.**

| 한국어 | English | 日本語 | 비고 |
|---|---|---|---|
| 하네스 | harness | ハーネス | |
| 벤치 / 벤치마크 | bench / benchmark | ベンチ / ベンチマーク | |
| 프로바이더 | provider | プロバイダー | |
| 모델 | model | モデル | |
| 시나리오 | scenario | シナリオ | |
| 프로파일 | profile | プロファイル | |
| 스코어보드 | scoreboard | スコアボード | |
| 채점 | scoring | 採点 | |
| 품질 | quality | 品質 | |
| 속도 | speed | 速度 | |
| 지연 | latency | レイテンシ | |
| 처리량 | throughput | スループット | |
| 누수 | leak | リーク | thinking/channel leak |
| 정체 | stall | ストール | |
| 오염 가드 / 경합 가드 | pollution guard / contention guard | 汚染ガード / 競合ガード | |
| 사고 블록 / 사고 | thinking block / thinking | 思考ブロック / 思考 | reasoning content |
| 예산 소진 | budget exhausted | バジェット枯渇 | |
| 합격 / 불합격 | pass / fail | 合格 / 不合格 | |
| 텍스트 / 비전 / 에이전트 | text / vision / agent | テキスト / ビジョン / エージェント | 카테고리 |
| 총합 | total | 合計 | |
| 워크로드 | workload | ワークロード | |
| 워커 | worker | ワーカー | stress worker |
| 동시성 / 동시 사용자 | concurrency / concurrent users | 同時実行 / 同時ユーザー | |
| 단계 / 램프 | stage / ramp | ステージ / ランプ | |
| 감지 | detection | 検出 | provider detect |
| 미리보기 | preview | プレビュー | |
| 상세 | detail(s) | 詳細 | |
| 실행 | run / running | 実行 | |
| 결과 | result(s) | 結果 | |
| 통계 | stats / statistics | 統計 | |
| 모니터 | monitor | モニター | |
| 로드 / 언로드 | load / unload | ロード / アンロード | model load |
| 익스포트 | export | エクスポート | |
| 복사 / 복사됨 | copy / copied | コピー / コピーしました | |
| 닫기 / 열기 | close / open | 閉じる / 開く | |
| 확대 | zoom / enlarge | 拡大 | image |
| 샘플링 | sampling | サンプリング | |
| 컨텍스트 | context | コンテキスト | |
| 런타임 | runtime | ランタイム | |
| 도구 | tool(s) | ツール | |
| 라우트 | route | ルート | api route |
| 목차 | contents / table of contents | 目次 | |
| 레퍼런스 | references | リファレンス | |
| 용어 설명 | glossary | 用語集 | |

## 규칙

- **프롬프트/코퍼스/채점 상수(모델 입력·비교 기준)는 번역 금지** — `packages/shared`의 `scenarios-preview.ts`, `stress-long-context-corpus.ts`, `scenario-scoring-constants.ts` 등. 벤치마크 동작이 바뀐다.
- 개발자 주석(`//`, `/* */`)은 한국어 유지.
- 옵션 라벨 endonym(한국어/English/日本語)은 자기 언어로 고정, 번역하지 않음.
