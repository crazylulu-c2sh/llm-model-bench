import {
  Activity,
  BarChart3,
  BookOpen,
  Cpu,
  FlaskConical,
  Gauge,
  History,
  Loader2,
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
  `min-w-0 rounded-md px-2.5 py-2 text-center text-sm font-semibold tracking-tight no-underline transition-colors lg:min-w-[4.5rem] lg:px-4 lg:text-base ${
    isActive
      ? "bg-[var(--accent)] text-white shadow-md"
      : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
  }`;

export function AppHeader({
  themeChoice,
  setThemeChoice,
  running,
  benchHeaderLine,
  benchLiveSoft,
}: {
  themeChoice: ThemeChoice;
  setThemeChoice: (choice: ThemeChoice) => void;
  running: boolean;
  benchHeaderLine: string;
  benchLiveSoft: string;
}) {
  const { pathname } = useLocation();
  const onBenchPage = pathname === "/";

  return (
    <header className="sticky top-0 z-20 grid grid-cols-1 items-center gap-y-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-4 shadow-sm lg:grid-cols-[1fr_auto_1fr] lg:gap-x-4 lg:gap-y-0 lg:px-6">
      <div className="flex min-w-0 items-start gap-3 justify-self-start">
        <span className="mt-0.5 shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--accent)]">
          <Activity className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">LLM Model Bench</h1>
          <p className="text-sm text-[var(--muted)]">{subtitleForPath(pathname)}</p>
          {running && onBenchPage ? (
            <div
              className={[
                "mt-2 flex min-w-0 items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--foreground)]",
                benchLiveSoft,
              ].join(" ")}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" aria-hidden />
              <span className="min-w-0 truncate">벤치 실행 중 · {benchHeaderLine}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 justify-self-center lg:px-2" role="tablist" aria-label="페이지">
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
              <span className="inline-flex items-center justify-center gap-0 lg:gap-1.5">
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="hidden whitespace-nowrap lg:inline">{label}</span>
              </span>
            </NavLink>
            );
          })}
        </div>
      </div>
      <label className="grid justify-self-end gap-1 text-sm">
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
