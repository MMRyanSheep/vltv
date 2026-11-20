import { ArrowLeft, CalendarDays, LayoutList } from "lucide-react";
import Link from "next/link";
import { cache } from "react";
import { TeamLogo } from "@/components/event-matchup";
import { TeamOverview } from "@/components/team-overview";
import { TeamSchedule } from "@/components/team-schedule";
import { readArchive, readMapCatalog } from "@/lib/api";
import { teamHref } from "@/lib/events";
import type { TeamDetail } from "@/lib/teams";
import "../../events/events.css";
import "../teams.css";

const readTeam = cache((id: string) => readArchive<TeamDetail>(teamHref(id)));

export async function generateMetadata({ params }: PageProps<"/teams/[id]">) {
  const { id } = await params;
  const { team } = await readTeam(id);
  return { title: team.name };
}

export default async function TeamPage({ params, searchParams }: PageProps<"/teams/[id]">) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const href = teamHref(id);
  const schedule = tab === "schedule";
  const [{ team, events, series, maps }, catalog] = await Promise.all([readTeam(id), schedule ? {} : readMapCatalog()]);
  return <article className="team-page">
    <div className="breadcrumbs"><Link href="/teams"><ArrowLeft size={16} />战队索引</Link></div>
    <header className="team-hero">
      <TeamLogo team={team} />
      <div><h1>{team.name}</h1><p>{team.tag}</p></div>
    </header>
    <nav className="team-tabs" aria-label="战队详情">
      <Link href={href} aria-current={!schedule ? "page" : undefined} scroll={false}><LayoutList size={17} />基础信息</Link>
      <Link href={`${href}?tab=schedule`} aria-current={schedule ? "page" : undefined} scroll={false}>
        <CalendarDays size={17} />赛程 <span>{series.length}</span>
      </Link>
    </nav>
    {schedule ? <TeamSchedule key={id} series={series} events={events} />
      : <TeamOverview key={id} maps={maps} series={series} events={events} catalog={catalog} />}
  </article>;
}
