import { useLayoutEffect } from "react";

/**
 * `locked`인 동안 body 스크롤을 잠그고, 풀릴 때 스크롤 위치를 복원한다.
 * iOS Safari는 `overflow: hidden`만으로 터치 스크롤을 막지 못하므로 `position: fixed` 방식 사용.
 */
export function useScrollLock(locked: boolean) {
  useLayoutEffect(() => {
    if (!locked) return;
    const scrollY = window.scrollY;
    const { body } = document;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    Object.assign(body.style, {
      position: "fixed",
      top: `-${scrollY}px`,
      left: "0",
      right: "0",
      width: "100%",
      overflow: "hidden",
    });
    return () => {
      Object.assign(body.style, prev);
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}
