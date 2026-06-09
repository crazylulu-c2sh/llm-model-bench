import { useLayoutEffect } from "react";

/**
 * 문서 전체에 하나만 적용되는 body 스크롤 락(ref-count). 여러 오버레이가 중첩돼도
 * 첫 락만 `position: fixed`를 적용하고 마지막 해제만 복원하므로 스크롤 위치가 유실되지 않는다.
 * iOS Safari는 `overflow: hidden`만으로 터치 스크롤을 막지 못해 `position: fixed` 방식 사용.
 */
type BodyStyleSnapshot = Pick<CSSStyleDeclaration, "position" | "top" | "left" | "right" | "width" | "overflow">;

let lockCount = 0;
let savedScrollY = 0;
let savedStyles: BodyStyleSnapshot | null = null;

function lockBody() {
  if (lockCount === 0) {
    savedScrollY = window.scrollY;
    const { body } = document;
    savedStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    Object.assign(body.style, {
      position: "fixed",
      top: `-${savedScrollY}px`,
      left: "0",
      right: "0",
      width: "100%",
      overflow: "hidden",
    });
  }
  lockCount += 1;
}

function unlockBody() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && savedStyles) {
    Object.assign(document.body.style, savedStyles);
    savedStyles = null;
    window.scrollTo(0, savedScrollY);
  }
}

/** `locked`인 동안 body 스크롤을 잠그고, 풀릴 때 스크롤 위치를 복원한다. */
export function useScrollLock(locked: boolean) {
  useLayoutEffect(() => {
    if (!locked) return;
    lockBody();
    return unlockBody;
  }, [locked]);
}
