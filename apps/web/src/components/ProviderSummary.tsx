import type { DetectResult } from "@llm-bench/shared";
import { AlertTriangle, Bot, Check, Cloud, Cpu, MessageSquare, Server, Wrench, X } from "lucide-react";

export function providerIcon(provider: DetectResult["provider"]) {
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

function stepHint(detect: DetectResult): string | null {
  const wantDetails =
    detect.models.length === 0 ||
    detect.reachability?.ok === false ||
    detect.provider === "manual";
  if (!wantDetails) return null;

  const bad = detect.steps.filter((s) => !s.ok || (s.detail && s.ok));
  const parts = bad
    .map((s) => {
      if (s.detail) return `${s.name}: ${s.detail}`;
      if (s.status != null) return `${s.name}: HTTP ${s.status}`;
      return `${s.name}`;
    })
    .slice(0, 3);
  if (!parts.length) return null;
  return parts.join(" · ");
}

export function ProviderSummary({ detect }: { detect: DetectResult }) {
  const PIcon = providerIcon(detect.provider);
  const rch = detect.reachability;
  const hint = stepHint(detect);

  return (
    <div className="mt-3 space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      {rch?.state === "unreachable" ? (
        <p className="flex items-start gap-2 text-xs text-[var(--chart-fail)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            서버에 닿지 못했습니다.
            {rch.reason ? ` ${rch.reason}` : ""}
          </span>
        </p>
      ) : rch?.state === "partial" ? (
        <p className="flex items-start gap-2 text-xs text-[var(--foreground)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
          <span>{rch.reason ?? "모델 목록 경로 일부만 응답했습니다."}</span>
        </p>
      ) : null}
      {rch?.state === "ok" && hint ? (
        <p className="text-xs text-[var(--muted)]" title={hint}>
          감지 단계: {hint}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
          <PIcon className="size-4 text-[var(--accent)]" aria-hidden />
          <span className="font-mono">{detect.provider}</span>
        </span>
        <span className="text-[var(--muted)]">·</span>
        <Badge ok={detect.capabilities.openaiChat} label="OpenAI /v1/chat/completions" icon={MessageSquare} />
        <Badge ok={detect.capabilities.anthropicMessages} label="Anthropic /v1/messages" icon={Bot} />
        <span className="ml-auto text-xs text-[var(--muted)]">모델 {detect.models.length}개</span>
      </div>
    </div>
  );
}
