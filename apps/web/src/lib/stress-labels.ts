import type { Messages } from "../i18n";

export function workloadLabel(m: Messages, id: string): string {
  return (m.stress.workload as Record<string, string | undefined>)[id] ?? id;
}
