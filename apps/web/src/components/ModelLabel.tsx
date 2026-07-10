import type { ProviderKind } from "@llm-bench/shared";
import { cleanModelDisplayName, inferModelVendor, parseModelQuant } from "@llm-bench/shared";
import { BackendIcon, VendorIcon, backendLabel } from "./VendorIcon";

/**
 * 표·툴팁 공용 모델 라벨: 벤더 아이콘 + 정제 표시명(+양자화 칩·백엔드 배지).
 * 전체 model_id는 `title`로. 모든 모델 표가 이걸 써서 표기를 일원화한다.
 */
export function ModelLabel({
  modelId,
  provider,
  size = 16,
  showBackend = false,
  showQuant = false,
  className,
}: {
  modelId: string;
  provider?: ProviderKind;
  size?: number;
  showBackend?: boolean;
  showQuant?: boolean;
  className?: string;
}) {
  const vendor = inferModelVendor(modelId);
  const display = cleanModelDisplayName(modelId);
  const quant = showQuant ? parseModelQuant(modelId) : null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className ?? ""}`}>
      <VendorIcon vendor={vendor} size={size} className="shrink-0" />
      <span className="truncate font-mono" title={modelId}>
        {display}
      </span>
      {quant ? (
        <span
          className="shrink-0 rounded border border-[var(--border)] px-1 py-px font-mono text-[10px] text-[var(--muted)]"
          title={`양자화 ${quant}`}
        >
          {quant}
        </span>
      ) : null}
      {showBackend && provider ? (
        <span className="shrink-0 text-[var(--muted)]" title={backendLabel(provider)} aria-label={backendLabel(provider)}>
          <BackendIcon provider={provider} size={12} />
        </span>
      ) : null}
    </span>
  );
}
