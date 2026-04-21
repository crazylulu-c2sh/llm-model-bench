import type { DetectResult } from "@llm-bench/shared";
import { Bot, Check, Cloud, Cpu, MessageSquare, Server, Wrench, X } from "lucide-react";

function providerIcon(provider: DetectResult["provider"]) {
  switch (provider) {
    case "lm_studio":
      return Cpu;
    case "ollama":
      return Server;
    case "openai_compatible":
      return Cloud;
    case "manual":
      return Wrench;
    default:
      return Bot;
  }
}

function Badge({
  ok,
  label,
  icon: Icon,
}: {
  ok: boolean;
  label: string;
  icon: typeof MessageSquare;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        ok
          ? "border-[var(--chart-pass)]/40 bg-[var(--chart-pass)]/10 text-[var(--chart-pass)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
      }`}
    >
      <Icon className="size-3.5 shrink-0 opacity-90" aria-hidden />
      {label}
      {ok ? <Check className="size-3" aria-hidden /> : <X className="size-3 text-[var(--chart-fail)]" aria-hidden />}
    </span>
  );
}

export function ProviderSummary({ detect }: { detect: DetectResult }) {
  const PIcon = providerIcon(detect.provider);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
        <PIcon className="size-4 text-[var(--accent)]" aria-hidden />
        <span className="font-mono">{detect.provider}</span>
      </span>
      <span className="text-[var(--muted)]">·</span>
      <Badge ok={detect.capabilities.openaiChat} label="chat/completions" icon={MessageSquare} />
      <Badge ok={detect.capabilities.anthropicMessages} label="/v1/messages" icon={Bot} />
      <span className="ml-auto text-xs text-[var(--muted)]">모델 {detect.models.length}개</span>
    </div>
  );
}
