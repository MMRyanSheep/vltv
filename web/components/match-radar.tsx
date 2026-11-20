"use client";

import { Radar } from "lucide-react";
import { useMemo, useState } from "react";
import { teamName, type MatchPlayer, type Round, type Team } from "@/lib/archive";
import { agent, playerName } from "@/lib/catalog";
import { formatRadarValue, MatchRadarChart, type RadarAxis } from "./match-radar-chart";
import { AgentAvatar } from "./presentation";
import styles from "./match-radar.module.css";

const teams = ["Blue", "Red"] as const;
const slots = [0, 1] as const;
type Slot = typeof slots[number];

function perRound(value: number | null | undefined, rounds: number) {
  return value != null && rounds > 0 ? value / rounds : null;
}

function playerMetrics(player: MatchPlayer, roundCount: number) {
  return [
    perRound(player.kills, roundCount),
    player.acs ?? null,
    player.adr ?? null,
    player.hs_percent ?? null,
    perRound(player.first_kills, roundCount),
    perRound(player.assists, roundCount),
    perRound(player.deaths, roundCount),
  ];
}

const metrics = [
  { name: "K/R", description: "每回合击杀", digits: 2 },
  { name: "ACS", description: "平均战斗分", digits: 1 },
  { name: "ADR", description: "每回合平均对敌伤害", digits: 1 },
  { name: "HS%", description: "爆头命中率", digits: 1, max: 100, unit: "%" },
  { name: "FK/R", description: "每回合首杀", digits: 2 },
  { name: "A/R", description: "每回合助攻", digits: 2 },
  { name: "D/R", description: "每回合阵亡", digits: 2 },
];

function getMatchMetrics(players: MatchPlayer[], rounds: Round[], roundCount: number, playerRoundCounts?: Record<string, number>) {
  const values = new Map(players.map((player) =>
    [player.player_id, playerMetrics(player, playerRoundCounts?.[player.player_id] ?? roundCount)]));
  const maxima = metrics.map(({ max }, index) => {
    const observed = Math.max(0, ...Array.from(values.values(), (row) => row[index] ?? 0));
    return max ?? (observed || 1);
  });
  const playerTeams = new Map(players.map(({ player_id, team_id }) => [player_id, team_id]));
  const duels = new Map<string, number>();
  for (const round of rounds) {
    for (const event of round.timeline.events) {
      if (event.type !== "kill" || !event.killer_id) continue;
      const killerTeam = playerTeams.get(event.killer_id);
      const victimTeam = playerTeams.get(event.victim_id);
      if (!killerTeam || !victimTeam || killerTeam === victimTeam) continue;
      const key = [event.killer_id, event.victim_id].join(":");
      duels.set(key, (duels.get(key) ?? 0) + 1);
    }
  }
  return { values, maxima, duels, duelMax: Math.max(1, ...duels.values()) };
}

export function MatchRadar({ players, rounds, roundCount, teamNames, playerRoundCounts }: {
  players: MatchPlayer[];
  rounds: Round[];
  roundCount: number;
  teamNames?: Record<Team, string>;
  playerRoundCounts?: Record<string, number>;
}) {
  const [selection, setSelection] = useState<[MatchPlayer?, MatchPlayer?]>(() => {
    const first = players.find((player) => player.team_id === "Blue") ?? players[0];
    const second = players.find((player) => player.team_id === "Red" && player !== first)
      ?? players.find((player) => player !== first);
    return [first, second];
  });
  const [activeSlot, setActiveSlot] = useState<Slot>(0);
  const { values, maxima, duels, duelMax } = useMemo(
    () => getMatchMetrics(players, rounds, roundCount, playerRoundCounts), [players, rounds, roundCount, playerRoundCounts],
  );

  function selectPlayer(player: MatchPlayer) {
    const selectedSlot = slots.find((slot) => selection[slot]?.player_id === player.player_id);
    if (selectedSlot !== undefined) {
      setActiveSlot(selectedSlot);
      return;
    }
    setSelection((current) => {
      const next = [...current] as typeof current;
      next[activeSlot] = player;
      return next;
    });
  }

  const axes: RadarAxis[] = metrics.map((metric, index) => {
    const comparison: RadarAxis["values"] = slots.map((slot) => {
      const player = selection[slot];
      return player ? values.get(player.player_id)?.[index] ?? null : null;
    });
    return { ...metric, max: maxima[index], values: comparison };
  });
  const [first, second] = selection;
  const hasDuel = first && second && first.team_id !== second.team_id && rounds.length > 0;
  axes.splice(1, 0, {
    name: "对位击杀", description: "击杀所比较的对手的次数（仅跨队）", digits: 0, max: duelMax,
    values: hasDuel
      ? [duels.get([first.player_id, second.player_id].join(":")) ?? 0,
         duels.get([second.player_id, first.player_id].join(":")) ?? 0]
      : [null, null],
  });

  const plotted = axes.filter((axis) => slots.every((slot) => !selection[slot] || axis.values[slot] != null));
  const canPlot = plotted.length >= 3;
  const otherAxes = canPlot ? axes.filter((axis) => !plotted.includes(axis)) : axes;

  function roster(team: Team) {
    const tint = team.toLowerCase();
    const name = teamNames?.[team] ?? teamName(team);
    return <div key={team} className={styles.roster} data-team={tint} role="group" aria-label={name}>
      <p className={tint}><span className="team-dot" />{name}</p>
      <div className={styles.players}>
        {players.filter((player) => player.team_id === team).map((player) => {
          const slot = slots.find((index) => selection[index]?.player_id === player.player_id);
          return <button type="button" key={player.player_id} aria-pressed={slot !== undefined}
            aria-label={`${name} · ${playerName(player)} · ${agent(player.agent_id).name}`}
            title={playerName(player)} data-slot={slot} onClick={() => selectPlayer(player)}>
            {slot !== undefined && <span className={styles.badge} aria-hidden="true">{slot + 1}</span>}
            <AgentAvatar id={player.agent_id} player={player} />
            <span className={styles.playerName}>{playerName(player)}</span>
          </button>;
        })}
      </div>
    </div>;
  }

  return <section className={`panel ${styles.panel}`} id="radar" aria-labelledby="radar-title">
    <div className="section-head">
      <h2 id="radar-title"><Radar size={18} className="accent" aria-hidden="true" /> 选手雷达图</h2>
      {second && !teamNames && <p>选择对比位置，再点击任一选手</p>}
    </div>
    {!first ? <p className="empty-inline">本场暂无选手数据。</p> :
      <div className={styles.layout}>
        {teams.map(roster)}
        <div className={styles.comparison}>
          <div className={styles.slots} role="group" aria-label="对比位置">
            {slots.map((slot) => {
              const player = selection[slot];
              return player && <button key={slot} type="button" data-slot={slot}
                aria-pressed={slot === activeSlot} onClick={() => setActiveSlot(slot)}
                aria-label={`对比位置 ${slot + 1} · ${teamNames?.[player.team_id] ?? teamName(player.team_id)} · ${playerName(player)}`}
                title={playerName(player)}>
                <span className={styles.badge}>{slot + 1}</span>
                <span className={styles.playerName}>{playerName(player)}</span>
              </button>;
            })}
          </div>
          {canPlot && <MatchRadarChart axes={plotted} names={selection.map((player) => player && playerName(player))} />}
          {otherAxes.length > 0 && <dl className={styles.otherAxes}>
            {otherAxes.map((axis) => <div key={axis.name} title={axis.description}>
              <dt>{axis.name}</dt>
              <dd>{slots.map((slot) => selection[slot] && <span key={slot} data-slot={slot} className="mono">
                <span className="sr-only">{playerName(selection[slot])} </span>{formatRadarValue(axis, slot)}
              </span>)}</dd>
            </div>)}
          </dl>}
          <div className={styles.summaries} aria-label="所选选手本局数据">
            {slots.map((slot) => {
              const player = selection[slot];
              return player && <div key={slot} className={styles.summary} data-slot={slot}>
                <AgentAvatar id={player.agent_id} />
                <div>
                  <strong>{agent(player.agent_id).name}</strong>
                  <p className="mono">K/D/A {player.kills ?? "—"}/{player.deaths ?? "—"}/{player.assists ?? "—"}</p>
                  <p className="mono">ACS {player.acs?.toFixed(1) ?? "—"}</p>
                </div>
              </div>;
            })}
          </div>
        </div>
      </div>}
  </section>;
}
