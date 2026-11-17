import { House, Search, Users, type LucideIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

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

function Logo({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[11px]"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, var(--tb), var(--tp))",
        boxShadow: "0 0 24px -2px color-mix(in srgb, var(--tb) 85%, transparent)",
      }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round">
        <ellipse cx="12" cy="12" rx="9" ry="5.2" transform="rotate(-35 12 12)" />
        <path d="M9 15l6-6M10.5 11.5l2 2M12 10l2 2" />
      </svg>
    </span>
  );
}

/** Header search: jumps to the Players screen with the query filled in. */
function HeaderSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/players?q=${encodeURIComponent(term)}`);
  };
  return (
    <form role="search" onSubmit={submit} className="flex min-w-0 flex-[1_1_16rem]">
      <label htmlFor={id} className="sr-only">
        Search players
      </label>
      <div className="flex min-h-11 w-full items-center gap-2.5 rounded-full border border-white/10 bg-black/50 px-4">
        <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          id={id}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any player since 1999"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-[0.95rem] text-ink outline-none placeholder:text-faint"
        />
      </div>
    </form>
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
  return (
    <div className="page-bg min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-black focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop and tablet header */}
      <div className="mx-auto hidden max-w-[80rem] px-6 pt-5 md:block">
        <header className="panel flex flex-wrap items-center gap-3.5 !rounded-full py-2.5 pl-4 pr-3">
          <span className="flex items-center gap-2.5">
            <Logo />
            <span className="disp text-[1.4rem]">NFL Analytics</span>
          </span>
          <nav aria-label="Main" className="flex gap-1.5">
            {PLACES.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className="pill">
                {label}
              </NavLink>
            ))}
          </nav>
          <HeaderSearch />
        </header>
      </div>

      {/* Phone top bar */}
      <div className="flex items-center gap-2.5 px-4 pt-4 md:hidden">
        <Logo size={32} />
        <span className="disp text-[1.3rem]">NFL Analytics</span>
      </div>

      <main id="main" className="mx-auto w-full max-w-[80rem] px-4 pb-32 pt-5 sm:px-6 md:pb-16 md:pt-6">
        <Outlet />
        <Credits className="mt-10" />
      </main>

      {/* Phone tab bar: a floating glass pill above the home indicator */}
      <nav
        aria-label="Main"
        className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-[rgba(14,14,16,0.86)] p-1.5 shadow-[0_18px_40px_-14px_rgba(0,0,0,0.9)] backdrop-blur-md md:hidden"
      >
        {PLACES.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="flex min-h-12 rounded-full text-muted hover:text-ink">
            {({ isActive }) => (
              <span
                className="flex h-full w-full items-center justify-center gap-2 rounded-full"
                style={
                  isActive
                    ? {
                        background: "linear-gradient(135deg, var(--tb), var(--tp))",
                        boxShadow: "0 0 22px -4px color-mix(in srgb, var(--tb) 85%, transparent)",
                        color: "#fff",
                      }
                    : undefined
                }
              >
                <Icon size={20} aria-hidden="true" />
                <span className="text-sm font-bold">{label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
