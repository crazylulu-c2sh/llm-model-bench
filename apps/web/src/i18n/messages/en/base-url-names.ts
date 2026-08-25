// Base URL alias (naming bench target systems) namespace. Mirrors the ko key structure exactly.
export const baseUrlNames = {
  title: "Name this Base URL",
  urlLabel: "Base URL",
  nameLabel: "Name (optional)",
  placeholder: "e.g., LM Studio (Mac mini)",
  noteLabel: "Device / specs (optional)",
  notePlaceholder: "e.g., M4 Pro Mac mini 64GB · RTX 4060",
  emptyClearsHint: "Saving an empty field clears it — an empty name removes the alias entirely.",
  save: "Save",
  renameAria: (url: string) => `Set or change the name for ${url}`,
  toastNamed: (name: string) => `Saved as "${name}"`,
  toastCleared: "Base URL name removed",
  quickPickLabel: "Saved Base URLs",
  quickPickCustom: "Custom entry",
  quickPickOption: (name: string, url: string, note?: string) =>
    note ? `${name} (${note}) · ${url}` : `${name} · ${url}`,
};
