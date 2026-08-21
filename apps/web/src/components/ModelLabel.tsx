import type { ProviderKind } from "@llm-bench/shared";
import { cleanModelDisplayName, inferModelVendor, inferParamTier, parseModelQuant } from "@llm-bench/shared";
import { useI18n } from "../i18n";
import { paramTierColor, paramTierLabel } from "../lib/param-tier";
import { BackendIcon, VendorIcon, backendLabel } from "./VendorIcon";

/**
 * 표·툴팁 공용 모델 라벨: 벤더 아이콘 + 정제 표시명(+양자화 칩·규모 등급 칩·백엔드 배지).
 * 전체 model_id는 `title`로. 모든 모델 표가 이걸 써서 표기를 일원화한다.
 */
export function ModelLabel({
  modelId,
  provider,
  paramsString,
  size = 16,
  showBackend = false,
  showQuant = false,
  showTier = false,
  className,
}: {
  modelId: string;
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
  const display = cleanModelDisplayName(modelId);
  const quant = showQuant ? parseModelQuant(modelId) : null;
  const tier = showTier ? inferParamTier({ modelId, paramsString }) : null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className ?? ""}`}>
      <VendorIcon vendor={vendor} size={size} className="shrink-0" />
      <span className="truncate font-mono" title={modelId}>
        {display}
      </span>
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
        <span className="shrink-0 text-[var(--muted)]" title={backendLabel(provider, m)} aria-label={backendLabel(provider, m)}>
          <BackendIcon provider={provider} size={12} />
        </span>
      ) : null}
    </span>
  );
}
