import Link from "next/link";
import { TeamLogo } from "@/components/event-matchup";
import { readArchive } from "@/lib/api";
import { teamHref, type EventTeam } from "@/lib/events";
import "../events/events.css";
import "./teams.css";

export const metadata = { title: "战队索引" };

export default async function TeamsPage() {
  const teams = await readArchive<EventTeam[]>("/teams");
  return <section className="team-directory">
    <h1>战队索引</h1>
    {teams.length ? <ul>{teams.map((team) => <li key={team.team_id}>
      <Link href={teamHref(team.team_id)}><TeamLogo team={team} /><span><strong>{team.name}</strong><small>{team.tag}</small></span></Link>
    </li>)}</ul> : <p className="team-empty">暂无战队。</p>}
  </section>;
}
