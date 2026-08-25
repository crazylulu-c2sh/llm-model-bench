// Base URL の別名(ベンチ対象システムの名付け)ネームスペース。ko とキー構造が正確に一致すること.
export const baseUrlNames = {
  title: "Base URL に名前を付ける",
  urlLabel: "Base URL",
  nameLabel: "名前（任意）",
  placeholder: "例: LM Studio (Mac mini)",
  noteLabel: "機器/スペック（任意）",
  notePlaceholder: "例: M4 Pro Mac mini 64GB · RTX 4060",
  emptyClearsHint: "空欄のまま保存すると削除されます — 名前を空欄にすると別名自体が削除されます。",
  save: "保存",
  renameAria: (url: string) => `${url} の名前の設定または変更`,
  toastNamed: (name: string) => `「${name}」として保存しました`,
  toastCleared: "Base URL の名前を削除しました",
  quickPickLabel: "保存済み Base URL",
  quickPickCustom: "手入力",
  quickPickOption: (name: string, url: string, note?: string) =>
    note ? `${name} (${note}) · ${url}` : `${name} · ${url}`,
};
