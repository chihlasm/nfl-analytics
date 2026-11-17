import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router";

import { AppShell } from "./components/AppShell";
import { Notice } from "./components/Notice";
import { ApiError } from "./lib/api";
import { Home } from "./routes/Home";

/** Home is in the first download; the other screens load the first time they're opened. */
const screens = {
  players: () => import("./routes/Players").then((m) => ({ Component: m.Players })),
  player: () => import("./routes/Player").then((m) => ({ Component: m.Player })),
  teams: () => import("./routes/Teams").then((m) => ({ Component: m.Teams })),
  team: () => import("./routes/Team").then((m) => ({ Component: m.Team })),
  explorer: () => import("./routes/Explorer").then((m) => ({ Component: m.Explorer })),
  settings: () => import("./routes/Settings").then((m) => ({ Component: m.Settings })),
};

function warmScreens() {
  const warm = () => Object.values(screens).forEach((load) => void load().catch(() => undefined));
  if ("requestIdleCallback" in window) window.requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 2000);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

function NotFound() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <h1 className="disp text-[4rem] leading-[0.84] text-white">Page not found</h1>
      <Notice>
        That address doesn't match anything here.{" "}
        <Link to="/" className="font-medium underline underline-offset-4">
          Go to the home page
        </Link>
        .
      </Notice>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: "players", lazy: screens.players },
      { path: "players/:id", lazy: screens.player },
      { path: "teams", lazy: screens.teams },
      { path: "teams/:abbr", lazy: screens.team },
      { path: "explorer", lazy: screens.explorer },
      { path: "settings", lazy: screens.settings },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
warmScreens();
