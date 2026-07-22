import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
// 로케일 스토어를 먼저 초기화 → 첫 페인트 전에 <html lang>(및 :lang() 폰트 스코프)이 맞춰진다.
import "./i18n/locale";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
      useTransitions={false}: react-router 7 wraps location updates in
      React.startTransition by default, making the route swap a low-priority,
      starvable transition. On /stats, selecting a model mounts a heavy recharts
      subtree; committing the route swap then needs one large synchronous commit
      that the transition never lands (URL changes, content stays). Sync-lane
      navigation commits on the next tick and is not starvable.
    */}
    <BrowserRouter useTransitions={false}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
