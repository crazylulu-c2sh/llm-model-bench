import { useCallback, useLayoutEffect, useState } from "react";

export type ThemeChoice = "dark" | "light" | "system";

const STORAGE_KEY = "llm-bench-theme";

function readStored(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function resolveTheme(choice: ThemeChoice): "dark" | "light" {
  if (typeof window === "undefined") {
    return "light";
  }
  if (choice === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return choice;
}

function applyToDocument(resolved: "dark" | "light") {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored);

  useLayoutEffect(() => {
    applyToDocument(resolveTheme(choice));
  }, [choice]);

  useLayoutEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyToDocument(resolveTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyToDocument(resolveTheme(next));
  }, []);

  return { choice, setChoice, resolved: resolveTheme(choice) };
}
