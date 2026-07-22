import {
  Activity,
  BarChart3,
  BookOpen,
  Cpu,
  FlaskConical,
  Gauge,
  History,
  Languages,
  Monitor,
  Moon,
  Settings2,
  Sun,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import type { ThemeChoice } from "../useTheme";
import { LOCALES, LOCALE_ENDONYMS, useI18n, type Locale, type Messages } from "../i18n";

type NavKey = keyof Messages["header"]["nav"];

const NAV_TABS: Array<{
  to: string;
  end?: boolean;
  labelKey: NavKey;
  icon: LucideIcon;
}> = [
  { to: "/", end: true, labelKey: "bench", icon: FlaskConical },
  { to: "/stats", labelKey: "stats", icon: BarChart3 },
  { to: "/stress", labelKey: "stress", icon: Gauge },
  { to: "/provider-stats", labelKey: "providerStats", icon: History },
  { to: "/profile", labelKey: "profile", icon: Settings2 },
  { to: "/provider-monitor", labelKey: "monitor", icon: Cpu },
  { to: "/scenarios", labelKey: "scenarios", icon: BookOpen },
  { to: "/harness", labelKey: "harness", icon: Wrench },
];

/** 라우트 → 부제목 키. 미매칭(홈 포함)은 bench 부제목. */
const SUBTITLE_KEY_BY_PATH: Record<string, keyof Messages["header"]["subtitle"]> = {
  "/stats": "stats",
  "/stress": "stress",
  "/provider-stats": "providerStats",
  "/profile": "profile",
  "/provider-monitor": "monitor",
  "/scenarios": "scenarios",
  "/harness": "harness",
};

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "dark") return <Moon className="size-4 text-[var(--muted)]" aria-hidden />;
  if (choice === "light") return <Sun className="size-4 text-[var(--muted)]" aria-hidden />;
  return <Monitor className="size-4 text-[var(--muted)]" aria-hidden />;
}

/** KWCAG 6.4.2 제목 제공: 라우트별 document.title — NAV_TABS 라벨 재사용 (App.tsx에서 소비) */
export function pageTitleForPath(pathname: string, m: Messages): string {
  const tab = NAV_TABS.find((t) => t.to === pathname);
  return tab ? `${m.header.nav[tab.labelKey]} · LLM Model Bench` : "LLM Model Bench";
}

function subtitleForPath(pathname: string, m: Messages): string {
  const key = SUBTITLE_KEY_BY_PATH[pathname] ?? "bench";
  return m.header.subtitle[key];
}

const tabLinkClass = (isActive: boolean) =>
  `group min-w-0 border-b-2 px-3 pt-1.5 pb-3 text-center text-sm tracking-tight no-underline transition-[color,border-color] duration-200 ${
    isActive
      ? "border-[var(--accent)] font-semibold text-[var(--foreground)]"
      : "border-transparent font-medium text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--foreground)]"
  }`;

const tabLabelClass = (isActive: boolean) =>
  [
    "inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out xl:max-w-none xl:opacity-100 xl:ml-0 xl:overflow-visible",
    isActive
      ? "max-w-[12rem] opacity-100 ml-1.5"
      : "max-w-0 opacity-0 group-hover:max-w-[12rem] group-hover:opacity-100 group-hover:ml-1.5",
  ].join(" ");

export type BenchHeaderProgress = { pct: number; completed: number; total: number };

export function AppHeader({
  themeChoice,
  setThemeChoice,
  running,
  benchProgress,
}: {
  themeChoice: ThemeChoice;
  setThemeChoice: (choice: ThemeChoice) => void;
  running: boolean;
  benchProgress?: BenchHeaderProgress;
}) {
  const { pathname } = useLocation();
  const { locale, setLocale, m } = useI18n();
  const onBenchPage = pathname === "/";
  const subtitle = subtitleForPath(pathname, m);
  const showBenchProgress = running && onBenchPage && benchProgress != null;
  const progressPct = benchProgress?.pct ?? 0;
  const progressText = benchProgress
    ? m.header.benchProgress(benchProgress.completed, benchProgress.total, benchProgress.pct)
    : m.header.benchProgressShort;

  return (
    <header
      className={[
        "sticky top-0 z-20 flex flex-col gap-y-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 pt-4 shadow-sm xl:px-6",
        showBenchProgress ? "app-header--bench-progress relative overflow-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...(showBenchProgress
        ? {
            role: "progressbar" as const,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": progressPct,
            "aria-valuetext": progressText,
          }
        : {})}
    >
      {showBenchProgress ? (
        <>
          <div
            className="app-header__progress-fill pointer-events-none absolute inset-y-0 left-0"
            style={{ width: `${progressPct}%` }}
            aria-hidden
          />
          <div
            className="app-header__progress-bar pointer-events-none absolute bottom-0 left-0"
            style={{ width: `${progressPct}%` }}
            aria-hidden
          />
        </>
      ) : null}
      {/* Row 1: 로고 + 언어·테마 컨트롤 */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--accent)]">
            <Activity className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="whitespace-nowrap text-lg font-semibold tracking-tight">LLM Model Bench</h1>
            <p className="truncate text-sm text-[var(--muted)]" title={subtitle}>
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--muted)]">
            <Languages className="size-4 text-[var(--muted)]" aria-hidden />
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label={m.header.languageSelectAria}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LOCALE_ENDONYMS[l]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--muted)]">
            <ThemeIcon choice={themeChoice} />
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
              value={themeChoice}
              onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
              aria-label={m.header.themeSelectAria}
            >
              <option value="dark">{m.header.themeDark}</option>
              <option value="light">{m.header.themeLight}</option>
              <option value="system">{m.header.themeSystem}</option>
            </select>
          </label>
        </div>
      </div>
      {/* Row 2: 전폭 탭바 */}
      <nav className="relative z-10 min-w-0" aria-label={m.header.navAria}>
        <div className="flex w-full flex-nowrap gap-1 overflow-x-auto">
          {NAV_TABS.map(({ to, end, labelKey, icon: Icon }) => {
            const isActive = pathname === to;
            const label = m.header.nav[labelKey];
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                title={label}
                className={tabLinkClass(isActive)}
              >
                <span className="inline-flex items-center justify-center xl:gap-1.5">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className={tabLabelClass(isActive)}>{label}</span>
                </span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
