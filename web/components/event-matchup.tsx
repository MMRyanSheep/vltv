import { Shield } from "lucide-react";
import Link from "next/link";
import { catalogImage } from "@/lib/catalog";
import { teamHref, type EventTeam, type Series } from "@/lib/events";

export function TeamLogo({ team }: { team: EventTeam }) {
  return <span className="event-team-logo" aria-hidden="true">
    {team.logo_version ? <img src={catalogImage("event-teams", team.team_id, team.logo_version)} alt="" width={28} height={28} />
      : <Shield size={19} />}
  </span>;
}

export function EventMatchup({ series, fullNames, linkTeams }: { series: Series; fullNames?: boolean; linkTeams?: boolean }) {
  const { team_a, team_b, score_a, score_b, status } = series;
  const sideA = <><span>{fullNames ? team_a.name : team_a.tag}</span><TeamLogo team={team_a} /></>;
  const sideB = <><TeamLogo team={team_b} /><span>{fullNames ? team_b.name : team_b.tag}</span></>;
  return <span className="event-matchup">
    {linkTeams ? <Link className="event-side" href={teamHref(team_a.team_id)} title={team_a.name}>{sideA}</Link>
      : <span className="event-side" title={team_a.name}>{sideA}</span>}
    <span className="match-score event-score mono" aria-label={status === "scheduled" ? "暂无比分" : `${team_a.tag} ${score_a} 比 ${score_b} ${team_b.tag}`}>
      <span className="blue" data-trailing={score_a < score_b}>{status === "scheduled" ? "–" : score_a}</span>
      <i>:</i><span className="red" data-trailing={score_b < score_a}>{status === "scheduled" ? "–" : score_b}</span>
    </span>
    {linkTeams ? <Link className="event-side" href={teamHref(team_b.team_id)} title={team_b.name}>{sideB}</Link>
      : <span className="event-side" title={team_b.name}>{sideB}</span>}
  </span>;
}
