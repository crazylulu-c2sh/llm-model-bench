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
  Wrench,
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
  { to: "/harness", label: "하네스", icon: Wrench },
];

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "dark") return <Moon className="size-4 text-[var(--muted)]" aria-hidden />;
  if (choice === "light") return <Sun className="size-4 text-[var(--muted)]" aria-hidden />;
  return <Monitor className="size-4 text-[var(--muted)]" aria-hidden />;
}

/** KWCAG 6.4.2 제목 제공: 라우트별 document.title — NAV_TABS 라벨 재사용 (App.tsx에서 소비) */
export function pageTitleForPath(pathname: string): string {
  const tab = NAV_TABS.find((t) => t.to === pathname);
  return tab ? `${tab.label} · LLM Model Bench` : "LLM Model Bench";
}

function subtitleForPath(pathname: string): string {
  if (pathname === "/stats") return "SQLite에 저장된 최신 런 기준 메트릭·결과";
  if (pathname === "/provider-stats") return "SQLite에 저장된 프로바이더 벤치 런 — 필터·익스포트·삭제";
  if (pathname === "/provider-monitor") return "로드된 모델 · 메모리·GPU 모니터 · lms CLI 조작";
  if (pathname === "/profile") return "모델 패밀리별 샘플링·컨텍스트·런타임 적용 규칙";
  if (pathname === "/scenarios") return "시나리오 목적·도구·채점·프롬프트 미리보기";
  if (pathname === "/harness") return "벤치/스트레스 하네스 설계·기법 — 다른 프로젝트 참고용";
  if (pathname === "/stress") return "동시 사용자 부하 · 단계별 TPS · 라이브 워커 모니터";
  return "로컬 프로바이더 감지 · 단일 모델 시나리오 벤치";
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
      {/* Row 1: 로고 + 테마 컨트롤 */}
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
        <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--muted)]">
          <ThemeIcon choice={themeChoice} />
          <select
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
            value={themeChoice}
            onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
            aria-label="테마 선택"
          >
            <option value="dark">다크</option>
            <option value="light">라이트</option>
            <option value="system">시스템</option>
          </select>
        </label>
      </div>
      {/* Row 2: 전폭 탭바 */}
      <nav className="relative z-10 min-w-0" aria-label="주요 메뉴">
        <div className="flex w-full flex-nowrap gap-1 overflow-x-auto">
          {NAV_TABS.map(({ to, end, label, icon: Icon }) => {
            const isActive = pathname === to;
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
