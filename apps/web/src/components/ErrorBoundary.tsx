import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** 값이 바뀌면(예: 라우트 경로) 에러 상태를 초기화해 다음 페이지가 정상 렌더되게 함. */
  resetKeys?: readonly unknown[];
};

type State = { error: Error | null };

/**
 * 앱 단일 에러 경계. 하위 렌더/커밋에서 던진 예외를 잡아 전체 React 루트가 빈 화면으로
 * 언마운트되는 것을 막고, 복구 가능한 에러 UI로 대체한다. `resetKeys`(라우트 경로)가 바뀌면
 * 에러를 해제해 다른 탭으로 이동하면 정상 동작이 복구된다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 콘솔에 남겨 디버깅을 돕는다(서버 리포팅은 없음).
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section role="alert" className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">이 페이지를 표시하는 중 오류가 발생했습니다</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">
          다른 탭으로 이동하면 계속 사용할 수 있습니다. 문제가 반복되면 아래 오류 내용과 함께 알려주세요.
        </p>
        <pre className="mb-3 max-h-48 overflow-auto rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[11px] text-[var(--muted)]">
          {String(error?.stack ?? error?.message ?? error)}
        </pre>
        <button
          type="button"
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-[var(--surface-2)]"
          onClick={() => this.setState({ error: null })}
        >
          다시 시도
        </button>
      </section>
    );
  }
}

function sameKeys(a?: readonly unknown[], b?: readonly unknown[]): boolean {
  if (a === b) return true;
  if (a == null || b == null || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}
