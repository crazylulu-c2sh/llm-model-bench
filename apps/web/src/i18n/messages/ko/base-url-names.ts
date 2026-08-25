// Base URL 별칭(벤치 대상 시스템 이름 붙이기) 네임스페이스. ko가 진실의 원천.
export const baseUrlNames = {
  title: "Base URL에 이름 붙이기",
  urlLabel: "Base URL",
  nameLabel: "이름 (선택)",
  placeholder: "예: LM Studio (Mac mini)",
  noteLabel: "기기/스펙 (선택)",
  notePlaceholder: "예: M4 Pro Mac mini 64GB · RTX 4060",
  emptyClearsHint: "비워 두고 저장하면 지웁니다 — 이름을 비우면 별칭 자체가 제거됩니다.",
  save: "저장",
  renameAria: (url: string) => `${url} 이름 붙이거나 바꾸기`,
  toastNamed: (name: string) => `"${name}"(으)로 저장했습니다`,
  toastCleared: "Base URL 이름을 지웠습니다",
};
