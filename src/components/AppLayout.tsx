import { NavLink, Outlet, ScrollRestoration } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/cn";

const TABS: { to: string; label: string }[] = [
  { to: "/", label: "Overview" },
  { to: "/commit-tree", label: "Commit-Tree Path" },
  { to: "/ppoi-status", label: "PPOI Status" },
  { to: "/ppoi-path", label: "PPOI Path" },
  { to: "/operator", label: "Operator" },
  { to: "/architecture", label: "Architecture" },
];

export function AppLayout() {
  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <Header />

      <nav className="border-b border-fg-faint bg-bg sticky top-14 z-20">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 flex overflow-x-auto no-scrollbar">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === "/"}
              className={({ isActive }) =>
                cn(
                  "shrink-0 px-4 py-3 text-[0.75rem] font-medium uppercase tracking-[0.18em] font-mono",
                  "border-b-2 transition-colors",
                  isActive
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-secondary hover:text-fg"
                )
              }
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
