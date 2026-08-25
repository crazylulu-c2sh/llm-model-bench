import { useCallback, useEffect, useMemo, useState } from "react";
import { compareStringsPinned, normalizeBaseUrl, type BaseUrlNameItem } from "@llm-bench/shared";

/** Base URL 별칭 — 이름(짧은 표시명) + note(기기/스펙 메모). */
export type BaseUrlAlias = { name: string; note?: string };

/** 별칭이 붙은 Base URL 한 건 — 벤치 탭 빠른 선택 등 목록 UI용(정규화 URL 포함). */
export type NamedBaseUrl = BaseUrlAlias & { baseUrl: string };

function toAliasMap(items: BaseUrlNameItem[]): Map<string, BaseUrlAlias> {
  const map = new Map<string, BaseUrlAlias>();
  for (const it of items) {
    if (!it?.base_url || !it.name?.trim()) continue;
    const note = it.note?.trim();
    map.set(normalizeBaseUrl(it.base_url), { name: it.name.trim(), note: note || undefined });
  }
  return map;
}

/**
 * Base URL 별칭 훅 — 마운트 시 전체 목록을 1회 조회.
 * 비-OK·네트워크 실패(e2e 정적 프리뷰 등)는 조용히 빈 상태 → 표가 기존 그대로(원본 URL) 표시.
 */
export function useBaseUrlNames() {
  const [aliases, setAliases] = useState<Map<string, BaseUrlAlias>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/base-url-names");
        if (!res.ok) return;
        const j = (await res.json()) as { items?: BaseUrlNameItem[] };
        if (!cancelled) setAliases(toAliasMap(j.items ?? []));
      } catch {
        // 서버 미가용 — 별칭 꺼진 상태로 동작.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 특정 base_url(정규화)의 별칭 — 없으면 undefined. */
  const aliasFor = useCallback(
    (url?: string | null): BaseUrlAlias | undefined => (url ? aliases.get(normalizeBaseUrl(url)) : undefined),
    [aliases],
  );

  /** 이름이 붙은 Base URL 목록(이름 기준 정렬) — 빠른 선택 드롭다운용. */
  const namedBaseUrls = useMemo<NamedBaseUrl[]>(
    () =>
      [...aliases.entries()]
        .map(([baseUrl, alias]) => ({ baseUrl, ...alias }))
        .sort((a, b) => compareStringsPinned(a.name, b.name) || compareStringsPinned(a.baseUrl, b.baseUrl)),
    [aliases],
  );

  /** 별칭 저장(PUT) 후 성공 응답 기준 로컬 상태 갱신. 빈 이름 = 별칭 제거. 실패 시 throw. */
  const save = useCallback(async (baseUrl: string, name: string, note?: string): Promise<void> => {
    const res = await fetch("/api/base-url-names", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_url: baseUrl, name, note }),
    });
    if (!res.ok) throw new Error(`save_failed(${res.status})`);
    const key = normalizeBaseUrl(baseUrl);
    setAliases((prev) => {
      const next = new Map(prev);
      if (name.trim()) next.set(key, { name: name.trim(), note: (note ?? "").trim() || undefined });
      else next.delete(key);
      return next;
    });
  }, []);

  return { aliases, aliasFor, namedBaseUrls, save };
}
