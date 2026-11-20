import { Trophy } from "lucide-react";
import Link from "next/link";
import { agent } from "@/lib/catalog";
import type { WeeklySelection } from "@/lib/weekly-player";

export function PlayerOfTheWeek({ selection }: { selection: WeeklySelection | null }) {
  const hero = selection?.agent_id ? agent(selection.agent_id) : undefined;
  const artwork = selection ? hero?.artwork : "/weekly-agents/astra.webp";
  const name = selection
    ? selection.display_name ?? (hero?.artwork ? hero.name : `选手 #${selection.player_id.slice(0, 8)}`)
    : "KSCERATO";
  const highlight = selection ? selection.highlight : "8";

  return <section className="spotlight panel" aria-labelledby="spotlight-title">
    {artwork
      ? <img className="spotlight-art" src={artwork} alt={hero?.name ?? "星礈"} />
      : <Trophy className="spotlight-trophy" aria-hidden="true" />}
    <div className="spotlight-content">
      <div>
        {!selection && <span className="spotlight-sample">示例</span>}
        {selection
          ? <Link className="spotlight-name" href={`/players/${selection.player_id}`} title={name}>{name}</Link>
          : <strong className="spotlight-name">{name}</strong>}
        <h2 id="spotlight-title">Player of the week</h2>
      </div>
      <div>
        {highlight && <strong className="spotlight-highlight mono">{highlight}</strong>}
        <p className="spotlight-reason">{selection?.reason ?? "Clutches"}</p>
      </div>
    </div>
  </section>;
}
