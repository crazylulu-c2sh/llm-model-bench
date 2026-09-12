import { useRef, useState } from "react";
import type { DetectResult } from "@llm-bench/shared";

/** A result belongs to the exact connection credentials that produced it. */
export function useConnectionDetection(baseUrl: string, apiKey: string) {
  const key = JSON.stringify([baseUrl, apiKey]);
  const generation = useRef({ key, version: 0 });
  if (generation.current.key !== key) {
    generation.current = { key, version: generation.current.version + 1 };
  }
  const [result, setResult] = useState<{ key: string; value: DetectResult } | null>(null);
  // Clear during render so switching A → B → A cannot revive an obsolete detection.
  if (result && result.key !== key) setResult(null);
  const detect = result?.key === key ? result.value : null;
  function beginDetection() {
    const version = ++generation.current.version;
    setResult(null);
    return () => generation.current.version === version;
  }
  function setDetect(value: DetectResult | null) {
    setResult(value ? { key: JSON.stringify([value.baseUrl, apiKey]), value } : null);
  }
  return { detect, setDetect, beginDetection };
}
