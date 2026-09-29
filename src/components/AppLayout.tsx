import { NavLink, Outlet, ScrollRestoration } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/cn";

const TABS: { to: string; label: string }[] = [
  { to: "/", label: "Overview" },
  { to: "/observer", label: "Wire Observer" },
  { to: "/architecture", label: "Architecture" },
];

const TRANSPORT_TABS: { to: string; label: string }[] = [
  { to: "/leak/smoking-gun", label: "Smoking Gun" },
  { to: "/leak/variant-fingerprint", label: "Variant Fingerprint" },
];

function tabClass(isActive: boolean): string {
  return cn(
    "shrink-0 px-4 py-3 text-[0.75rem] font-medium uppercase tracking-[0.18em] font-mono",
    "border-b-2 transition-colors",
    isActive ? "border-accent text-fg" : "border-transparent text-fg-secondary hover:text-fg"
  );
}

export function AppLayout() {
  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <Header />

      <nav className="border-b border-fg-faint bg-bg sticky top-14 z-20">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 flex items-center overflow-x-auto no-scrollbar">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === "/"}
              className={({ isActive }) => tabClass(isActive)}
            >
              {tab.label}
            </NavLink>
          ))}

          <span className="shrink-0 h-4 w-px bg-fg-faint mx-1" aria-hidden />
          <span className="shrink-0 px-3 text-[0.6rem] uppercase tracking-[0.18em] text-fg-muted font-mono font-medium">
            Transport Layer
          </span>
          {TRANSPORT_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => tabClass(isActive)}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
      <ScrollRestoration />
    </div>
  );
}
