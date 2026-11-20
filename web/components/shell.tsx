"use client";

import { ArrowUp, CalendarDays, LayoutGrid, Shield, Trophy, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useState } from "react";

const PlayedDatesContext = createContext(false);

export function usePlayedDates() {
  return useContext(PlayedDatesContext);
}

const links = [
  { href: "/", label: "档案首页", icon: LayoutGrid, section: "home" },
  { href: "/events", label: "赛事", icon: Trophy, section: "events" },
  { href: "/teams", label: "战队", icon: Shield, section: "teams" },
  { href: "/?view=matches#matches", label: "比赛记录", icon: CalendarDays, section: "matches" },
  { href: "/?view=players#matches", label: "选手索引", icon: UsersRound, section: "players" },
];

function ArchiveNav({ section }: { section: string }) {
  return <nav className="secondary-nav" aria-label="档案导航">
    {links.map(({ href, label, icon: Icon, section: target }) => (
      <Link className="nav-link" key={href} href={href} aria-current={section === target ? "page" : undefined}>
        <Icon size={16} aria-hidden="true" />{label}
      </Link>
    ))}
  </nav>;
}

function SecondaryBar({ section, showSwitch, playedDates, onToggle }: {
  section: string; showSwitch?: boolean; playedDates?: boolean; onToggle?: () => void;
}) {
  return <div className="secondary-bar">
    <div className="bar-inner">
      <ArchiveNav section={section} />
      {showSwitch && <label className="played-dates" title="仅允许在日历中选择有比赛的日期">
        <span>仅有比赛</span>
        <input type="checkbox" role="switch" checked={playedDates} onChange={onToggle} />
        <span className="switch-track" aria-hidden="true" />
      </label>}
    </div>
  </div>;
}

function CurrentBar({ pathname, playedDates, onToggle }: {
  pathname: string; playedDates: boolean; onToggle: () => void;
}) {
  const view = useSearchParams().get("view");
  const section = pathname === "/" ? view === "players" || view === "matches" ? view : "home"
    : pathname === "/events" || pathname.startsWith("/events/") ? "events"
    : pathname === "/teams" || pathname.startsWith("/teams/") ? "teams"
    : pathname.startsWith("/matches/") ? "matches"
    : pathname.startsWith("/players/") ? "players" : "";
  return <SecondaryBar section={section} showSwitch={pathname === "/" && section !== "players"}
    playedDates={playedDates} onToggle={onToggle} />;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [playedDates, setPlayedDates] = useState(false);
  const archive = pathname === "/" || pathname.startsWith("/matches/") || pathname.startsWith("/players/") ||
    pathname === "/events" || pathname.startsWith("/events/") || pathname === "/teams" || pathname.startsWith("/teams/");
  return <div className="shell">
    <header className="site-header">
      <div className="topbar">
        <div className="bar-inner">
          <Link className="brand" href="/" aria-label="VLTV 首页">
            <span className="brand-mark" aria-hidden="true"><i /><i /></span>
            <strong>VLTV</strong>
          </Link>
          <nav className="main-nav" aria-label="主频道">
            <Link className="nav-link" href="/" aria-current={archive ? "true" : undefined}>战绩档案</Link>
          </nav>
          <Link href="/admin" className="admin-entry" aria-label="管理登录" prefetch={false} aria-current={pathname === "/admin" ? "page" : undefined}>
            <UserRound size={16} aria-hidden="true" /><span>管理登录</span>
          </Link>
        </div>
      </div>
      <Suspense fallback={<SecondaryBar section="" />}>
        <CurrentBar pathname={pathname} playedDates={playedDates} onToggle={() => setPlayedDates((value) => !value)} />
      </Suspense>
    </header>
    <PlayedDatesContext.Provider value={playedDates}>
      <main className="content">{children}</main>
    </PlayedDatesContext.Provider>
    <nav className="quick-tools" aria-label="快捷工具">
      <button type="button" title="返回顶部" aria-label="返回顶部" onClick={() => window.scrollTo({ top: 0 })}>
        <ArrowUp size={18} aria-hidden="true" />
      </button>
      <Link href="/?view=matches#matches" title="比赛记录" aria-label="比赛记录"><CalendarDays size={18} aria-hidden="true" /></Link>
    </nav>
  </div>;
}
