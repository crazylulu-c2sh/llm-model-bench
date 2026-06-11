import {
  Activity,
  BarChart3,
  BookOpen,
  Cpu,
  FlaskConical,
  Gauge,
  History,
  Monitor,
  Moon,
  Settings2,
  Sun,
  SunMoon,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import type { ThemeChoice } from "../useTheme";

const NAV_TABS: Array<{
  to: string;
  end?: boolean;
  label: string;
  icon: LucideIcon;
}> = [
  { to: "/", end: true, label: "모델 벤치", icon: FlaskConical },
  { to: "/stats", label: "모델 통계", icon: BarChart3 },
  { to: "/stress", label: "프로바이더 벤치", icon: Gauge },
  { to: "/provider-stats", label: "프로바이더 통계", icon: History },
  { to: "/profile", label: "프로파일", icon: Settings2 },
  { to: "/provider-monitor", label: "프로바이더 모니터", icon: Cpu },
  { to: "/scenarios", label: "시나리오", icon: BookOpen },
];

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "dark") return <Moon className="size-4 text-[var(--muted)]" aria-hidden />;
  if (choice === "light") return <Sun className="size-4 text-[var(--muted)]" aria-hidden />;
  return <Monitor className="size-4 text-[var(--muted)]" aria-hidden />;
}

function subtitleForPath(pathname: string): string {
  if (pathname === "/stats") return "SQLite에 저장된 최신 런 기준 메트릭·결과";
  if (pathname === "/provider-stats") return "SQLite에 저장된 프로바이더 벤치 런 — 필터·익스포트·삭제";
  if (pathname === "/provider-monitor") return "로드된 모델 · 메모리·GPU 모니터 · lms CLI 조작";
  if (pathname === "/profile") return "모델 패밀리별 샘플링·컨텍스트·런타임 적용 규칙";
  if (pathname === "/scenarios") return "시나리오 목적·도구·채점·프롬프트 미리보기";
  if (pathname === "/stress") return "동시 사용자 부하 · 단계별 TPS · 라이브 워커 모니터";
  return "로컬 프로바이더 감지 · 단일 모델 시나리오 벤치";
}

const tabLinkClass = (isActive: boolean) =>
  `group min-w-0 rounded-md px-2.5 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-[background-color,color,padding] duration-200 max-xl:hover:px-3 xl:min-w-[4.5rem] xl:px-4 xl:text-base ${
    isActive ? "max-xl:px-3 bg-[var(--accent)] text-white shadow-md" : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
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
  const onBenchPage = pathname === "/";
  const subtitle = subtitleForPath(pathname);
  const showBenchProgress = running && onBenchPage && benchProgress != null;
  const progressPct = benchProgress?.pct ?? 0;
  const progressText = benchProgress
    ? `벤치 실행 중 · ${benchProgress.completed}/${benchProgress.total} (${benchProgress.pct}%)`
    : "벤치 실행 중";

  return (
    <header
      className={[
        "sticky top-0 z-20 grid grid-cols-1 items-center gap-y-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 shadow-sm xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:gap-x-4 xl:gap-y-0 xl:px-6",
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
      <div className="relative z-10 flex min-w-0 shrink-0 items-start gap-3 justify-self-start xl:max-w-[min(100%,20rem)]">
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
      <div className="relative z-10 min-w-0 justify-self-center xl:px-2" role="tablist" aria-label="페이지">
        <span className="sr-only">페이지</span>
        <div className="flex max-w-full min-w-0 flex-nowrap justify-center gap-1 overflow-x-auto rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] p-1 shadow-sm">
          {NAV_TABS.map(({ to, end, label, icon: Icon }) => {
            const isActive = end ? pathname === to : pathname === to;
            return (
            <NavLink
              key={to}
              to={to}
              end={end}
              role="tab"
              aria-label={label}
              aria-selected={isActive}
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
      </div>
      <label className="relative z-10 grid justify-self-end gap-1 text-sm">
        <span className="inline-flex items-center gap-1 text-[var(--muted)]">
          <SunMoon className="size-3.5" aria-hidden />
          테마
        </span>
        <div className="flex items-center gap-2">
          <ThemeIcon choice={themeChoice} />
          <select
            className="min-w-[10rem] rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
            value={themeChoice}
            onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
            aria-label="테마 선택"
          >
            <option value="dark">다크</option>
            <option value="light">라이트</option>
            <option value="system">시스템</option>
          </select>
        </div>
      </label>
    </header>
  );
}
