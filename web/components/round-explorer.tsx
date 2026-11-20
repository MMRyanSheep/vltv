"use client";

import { Activity, Bomb, Crosshair, HeartPulse, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { teamName, type MatchPlayer, type Round, type RoundEvent } from "@/lib/archive";
import { playerName } from "@/lib/catalog";

export function RoundExplorer({ rounds, players }: { rounds: Round[]; players: MatchPlayer[] }) {
  const [index, setIndex] = useState(0);
  const { result, timeline } = rounds[index];
  const lookup = new Map(players.map((player) => [player.player_id, player]));

  const participant = (id: string | null) => {
    const player = id ? lookup.get(id) : null;
    return player
      ? <Link href={`/players/${player.player_id}`} className={player.team_id.toLowerCase()}>{playerName(player)}</Link>
      : <span className="subtle">未知来源</span>;
  };

  function describe(event: RoundEvent) {
    switch (event.type) {
      case "kill": return <>{participant(event.killer_id)} <span className="subtle">击杀</span> {participant(event.victim_id)}</>;
      case "revive": return <>{participant(event.target_id)} 被复活</>;
      case "spike_planted": return <>已部署爆能器 {event.site ? `· ${event.site} 点` : ""}</>;
      case "spike_defused": return <>爆能器已拆除</>;
      case "spike_exploded": return <>爆能器已引爆</>;
    }
  }

  return <section className="panel round-panel" id="rounds">
    <div className="section-head"><h2><Activity size={18} className="accent" /> 回合事件</h2></div>
    <div className="round-selector" role="group" aria-label="选择回合">
      {rounds.map(({ result: round }, i) => (
        <button type="button" key={round.round_id} onClick={() => setIndex(i)}
          aria-label={`第 ${round.round_id} 回合，${round.winner_team_id ? teamName(round.winner_team_id) + "获胜" : "无胜方"}`}
          aria-pressed={i === index} className={round.winner_team_id?.toLowerCase()}>
          {String(round.round_id).padStart(2, "0")}
        </button>
      ))}
    </div>
    <div className="round-summary">
      <strong>第 {result.round_id} 回合</strong>
      <span>进攻 {teamName(result.attacker_team_id)} · 防守 {teamName(result.defender_team_id)}</span>
      <span className={result.winner_team_id?.toLowerCase()}>{result.winner_team_id ? `${teamName(result.winner_team_id)}获胜` : "无胜方"}</span>
    </div>
    <div className="timeline">
      {timeline.events.length === 0 && <p className="empty-inline">本回合没有回放事件。</p>}
      {timeline.events.map((event, i) => {
        const ms = Math.max(0, event.time_ms - result.start_time_ms);
        const seconds = Math.floor(ms / 1000);
        const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
        const Icon = event.type === "kill" ? Crosshair : event.type === "revive" ? HeartPulse : event.type === "spike_defused" ? ShieldCheck : Bomb;
        return <div className="timeline-row" key={`${event.time_ms}-${i}`}>
          <time className="mono subtle">{clock}</time><Icon size={16} className="subtle" /><span>{describe(event)}</span>
          <span className="subtle round-alive">攻 {event.after.attackers_alive} · 守 {event.after.defenders_alive}</span>
        </div>;
      })}
    </div>
  </section>;
}
