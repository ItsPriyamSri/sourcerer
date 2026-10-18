import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "./lib/store.tsx";
import { BottomNav, Toasts, TopBar } from "./components/Chrome.tsx";
import ScanPage from "./routes/Scan.tsx";
import ListingsPage from "./routes/Listings.tsx";
import InsightsPage from "./routes/Insights.tsx";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <a
          href="#main"
          className="sr-only-focusable absolute left-3 top-3 z-50 rounded-lg px-3 py-2 text-sm font-semibold"
          style={{ background: "var(--ink)", color: "var(--bg)" }}
        >
          Skip to content
        </a>
        <TopBar />
        <div id="main">
          <Boot>
            <Routes>
              <Route path="/" element={<ScanPage />} />
              <Route path="/listings" element={<ListingsPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="*" element={<ScanPage />} />
            </Routes>
          </Boot>
        </div>
        <BottomNav />
        <Toasts />
      </BrowserRouter>
    </AppProvider>
  );
}

/**
 * Keep the first paint honest: the app is usable the instant React mounts, because
 * everything it needs is local. We only show a skeleton while IndexedDB opens.
 */
function Boot({ children }: { children: React.ReactNode }) {
  const { ready } = useApp();
  if (!ready) {
    return (
      <div className="mx-auto max-w-xl space-y-3 px-4 py-6" aria-busy="true" aria-label="Loading">
        <div className="card h-40 animate-pulse" />
        <div className="card h-24 animate-pulse" />
      </div>
    );
  }
  return <>{children}</>;
}
