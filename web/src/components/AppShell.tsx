import { House, Moon, Sun, Users, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";

import { setTheme, useTheme } from "../lib/theme";

interface Destination {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const PLACES: Destination[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/players", label: "Players", icon: Users },
];

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--color-inverse)" />
      <ellipse cx="32" cy="32" rx="21" ry="12.5" transform="rotate(-35 32 32)" fill="none" stroke="var(--color-on-inverse)" strokeWidth="4" />
      <path d="M24.5 39.5 39.5 24.5M27 30l4 4m-.5-7.5 4 4m-10.5 3 4 4" stroke="var(--color-on-inverse)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      className={`btn btn-quiet btn-icon ${className}`}
      onClick={() => setTheme(next)}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

function RailLink({ to, label, icon: Icon, end }: Destination) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-11 items-center gap-3 rounded-full px-3.5 text-[0.95rem] transition-colors ${
          isActive ? "bg-inverse font-semibold text-on-inverse" : "text-muted hover:bg-sunken hover:text-ink"
        }`
      }
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

function TabLink({ to, label, icon: Icon, end }: Destination) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        `flex min-h-12 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors ${
          isActive ? "bg-inverse px-4 text-on-inverse" : "text-muted hover:text-ink"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={isActive ? 18 : 22} strokeWidth={isActive ? 2.1 : 1.9} aria-hidden="true" />
          {isActive && <span aria-hidden="true">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

function Credits({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-faint ${className}`}>
      Data from nflverse. Charting by FTN Data via nflverse (CC-BY-SA 4.0). Stats update each morning.
    </p>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const playersActive = pathname.startsWith("/players");

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-8 md:px-4 md:py-7">
        <div className="flex items-center gap-2.5 px-2">
          <Mark size={30} />
          <span className="font-display text-lg font-semibold">NFL Analytics</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {PLACES.map((d) => (
            <RailLink key={d.to} {...d} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-4 px-2">
          <ThemeToggle className="self-start" />
          <Credits />
        </div>
      </aside>

      <main id="main" className="mx-auto w-full max-w-[52rem] px-4 pb-32 pt-6 sm:px-6 md:pb-16 md:pt-10">
        <div className="mb-6 flex items-center justify-between gap-2 md:hidden">
          <div className="flex items-center gap-2">
            <Mark size={26} />
            <span className="font-display font-semibold">NFL Analytics</span>
          </div>
          <ThemeToggle />
        </div>
        <Outlet />
        <Credits className="mt-10 md:hidden" />
      </main>

      {/* Phone tab bar: a floating pill above the home indicator */}
      <nav
        aria-label="Main"
        className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 grid gap-1 rounded-full border border-[var(--card-border)] bg-[var(--nav-surface)] p-2 shadow-[var(--shadow-float)] backdrop-blur-md transition-[grid-template-columns] duration-200 md:hidden"
        style={{ gridTemplateColumns: playersActive ? "1fr 1.6fr" : "1.6fr 1fr" }}
      >
        {PLACES.map((d) => (
          <TabLink key={d.to} {...d} />
        ))}
      </nav>
    </div>
  );
}
