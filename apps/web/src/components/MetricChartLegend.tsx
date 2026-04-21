/** 차트 하단 범례 + 결과 테이블 상단 안내에서 공통으로 쓰는 지표 설명 */

export function MetricChartLegend({ variant }: { variant: "session" | "compare" }) {
  return (
    <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[var(--foreground)]">
        <span className="inline-flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-sm bg-[var(--chart-ttft)]" aria-hidden />
          <span>
            <strong>TTFT</strong> (ms) — 첫 출력 토큰까지 시간
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-sm bg-[var(--chart-tpot)]" aria-hidden />
          <span>
            <strong>TPOT</strong> (ms) — 이후 출력 토큰당 평균 시간
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-sm bg-[var(--chart-tps)]" aria-hidden />
          <span>
            <strong>TPS</strong> (tok/s) — 출력 길이 기반 근사 토큰 ÷ 총 소요 시간
          </span>
        </span>
      </div>
      {variant === "compare" ? (
        <p className="text-center text-[11px] leading-snug text-[var(--muted)]">
          비교 막대: 각 모델마다 <strong className="text-[var(--foreground)]">TTFT</strong>,{" "}
          <strong className="text-[var(--foreground)]">TPOT</strong>,{" "}
          <strong className="text-[var(--foreground)]">TPS</strong> 막대가 이어집니다. ms는 아래 축, TPS는 위 축입니다. 색은 모델별로
          다릅니다.
        </p>
      ) : null}
    </div>
  );
}

export function MetricTableIntro() {
  return (
    <div className="mb-3 space-y-2 border-b border-[var(--border)] pb-3 text-xs leading-relaxed text-[var(--muted)]">
      <p>
        <strong className="text-[var(--foreground)]">시나리오</strong>는 벤치 과제 식별자,{" "}
        <strong className="text-[var(--foreground)]">API</strong>는 호출 엔드포인트 종류,{" "}
        <strong className="text-[var(--foreground)]">모델</strong>은 측정에 사용된 모델 ID입니다.
      </p>
      <p>
        <strong className="text-[var(--foreground)]">TTFT</strong>(ms)는 첫 출력 토큰까지 시간,{" "}
        <strong className="text-[var(--foreground)]">TPOT</strong>(ms)는 이후 출력 토큰당 평균 시간,{" "}
        <strong className="text-[var(--foreground)]">TPS</strong>(tok/s)는 출력 텍스트 길이 기반 근사 토큰 수를 총 소요 시간(초)으로 나눈
        값입니다.
      </p>
    </div>
  );
}
