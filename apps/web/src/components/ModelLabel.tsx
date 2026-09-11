import type { ProviderKind } from "@llm-bench/shared";
import {
  cleanModelDisplayName,
  inferModelVendor,
  inferParamTier,
  parseModelPublisherFromId,
  parseModelQuant,
} from "@llm-bench/shared";
import { useI18n } from "../i18n";
import { paramTierColor, paramTierLabel } from "../lib/param-tier";
import { BackendIcon, VendorIcon, backendLabel } from "./VendorIcon";

/**
 * 표·툴팁 공용 모델 라벨: 벤더 아이콘 + 게시자(1줄) / 정제 표시명(2줄)
 * (+양자화 칩·규모 등급 칩·백엔드 배지). 전체 model_id는 `title`로.
 */
export function ModelLabel({
  modelId,
  publisher,
  provider,
  paramsString,
  size = 16,
  showBackend = false,
  showQuant = false,
  showTier = false,
  className,
}: {
  modelId: string;
  /** detect/meta publisher. 없으면 id의 org/ 접두로 폴백. */
  publisher?: string | null;
  provider?: ProviderKind;
  /** LM Studio 등이 보고하는 크기 힌트(예: "7B") — 있으면 등급 판정에 우선 사용, 없으면 modelId로 폴백. */
  paramsString?: string | null;
  size?: number;
  showBackend?: boolean;
  showQuant?: boolean;
  showTier?: boolean;
  className?: string;
}) {
  const { m } = useI18n();
  const vendor = inferModelVendor(modelId);
  const resolvedPublisher =
    publisher?.trim() || parseModelPublisherFromId(modelId) || "";
  let display = cleanModelDisplayName(modelId);
  // 게시자 줄과 표시명이 겹치면 접두를 벗겨 중복을 피한다.
  if (resolvedPublisher) {
    const prefix = `${resolvedPublisher}/`;
    if (display.toLowerCase().startsWith(prefix.toLowerCase())) {
      display = display.slice(prefix.length) || display;
    }
  }
  const quant = showQuant ? parseModelQuant(modelId) : null;
  const tier = showTier ? inferParamTier({ modelId, paramsString }) : null;
  return (
    <span className={`inline-flex min-w-0 items-start gap-1.5 ${className ?? ""}`} title={modelId}>
      <VendorIcon vendor={vendor} size={size} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="truncate text-[10px] text-[var(--muted)]">
          {resolvedPublisher || "—"}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate font-mono">{display}</span>
          {quant ? (
            <span
              className="shrink-0 rounded border border-[var(--border)] px-1 py-px font-mono text-[10px] text-[var(--muted)]"
              title={m.common.quantTitle(quant)}
            >
              {quant}
            </span>
          ) : null}
          {showTier ? (
            <span
              className="shrink-0 rounded border px-1 py-px font-mono text-[10px]"
              style={{ borderColor: paramTierColor(tier), color: paramTierColor(tier) }}
              title={paramTierLabel(tier, m)}
            >
              {paramTierLabel(tier, m)}
            </span>
          ) : null}
          {showBackend && provider ? (
            // role 없는 span에서는 aria-label이 무시된다(axe aria-prohibited-attr / WCAG 4.1.2).
            // 자식 아이콘이 aria-hidden이라 role을 빼면 백엔드 배지가 이름 없이 사라진다 — role="img" 유지.
            <span
              role="img"
              className="shrink-0 text-[var(--muted)]"
              title={backendLabel(provider, m)}
              aria-label={backendLabel(provider, m)}
            >
              <BackendIcon provider={provider} size={12} />
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}
