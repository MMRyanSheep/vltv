import type { MatchPlayer } from "./archive";
import { mapInfo } from "./catalog";
import type { EventInfo, EventTier, EventTeam, Series } from "./events";

export type TeamSeries = Series & { tier: EventTier | null; target_is_a: boolean; recent: boolean };
export type TeamEvent = EventInfo & { first_place: number | null; last_place: number | null; last_match: string | null };
type TeamMapPlayer = Pick<MatchPlayer, "player_id" | "display_name" | "avatar_version" | "agent_id" |
  "kills" | "deaths" | "assists" | "acs" | "adr" | "kast" | "rating" | "swingscore">;
export type TeamMap = {
  series_id: string;
  event_id: string;
  starts_at: string;
  recent: boolean;
  slot: number;
  map_id: string;
  round_count: number;
  completed_rounds: number;
  team_score: number;
  opponent_score: number;
  players: TeamMapPlayer[];
};
export type TeamDetail = { team: EventTeam; series: TeamSeries[]; maps: TeamMap[]; events: TeamEvent[] };

export const opponent = (match: TeamSeries) => match.target_is_a ? match.team_b : match.team_a;
export const seriesWon = (match: TeamSeries) =>
  match.target_is_a ? match.score_a > match.score_b : match.score_b > match.score_a;

export function summarizeTeamMaps(maps: TeamMap[]) {
  type Record = { wins: number; losses: number };
  type Lineup = Record & { agents: string[] };
  const records = new Map<string, Record & { lineups: Map<string, Lineup> }>();
  for (const map of maps) {
    if (!map.round_count || map.round_count !== map.completed_rounds || map.team_score === map.opponent_score) continue;
    const code = mapInfo(map.map_id).code;
    const record = records.get(code) ?? { wins: 0, losses: 0, lineups: new Map<string, Lineup>() };
    records.set(code, record);
    const result = map.team_score > map.opponent_score ? "wins" : "losses";
    record[result]++;
    const agents = [...new Set(map.players.map((player) => player.agent_id))].sort();
    if (agents.length !== 5 || map.players.length !== 5) continue;
    const key = agents.join(",");
    const lineup = record.lineups.get(key) ?? { agents, wins: 0, losses: 0 };
    lineup[result]++;
    record.lineups.set(key, lineup);
  }
  const rows = Array.from(records, ([code, { wins, losses, lineups }]) => ({
    code, wins, losses, best: [...lineups.values()].sort((a, b) =>
      b.wins / (b.wins + b.losses) - a.wins / (a.wins + a.losses) ||
      (b.wins + b.losses) - (a.wins + a.losses))[0],
  })).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || a.code.localeCompare(b.code));
  return { rows, wins: rows.reduce((total, row) => total + row.wins, 0), losses: rows.reduce((total, row) => total + row.losses, 0) };
}

type Appearance = { map: TeamMap; player: TeamMapPlayer };
type AverageField = "rating" | "swingscore" | "acs" | "adr" | "kast";

function roundAverage(rows: Appearance[], field: AverageField) {
  let total = 0;
  let rounds = 0;
  for (const { map, player } of rows) {
    const count = field === "rating" ? map.completed_rounds : map.round_count;
    if (!count) continue;
    const value = player[field];
    if (value == null) {
      if (field === "rating") continue;
      return null;
    }
    total += value * count;
    rounds += count;
  }
  return rounds ? total / rounds : null;
}

export function summarizeTeamPlayers(maps: TeamMap[]) {
  const players = new Map<string, Appearance[]>();
  for (const map of maps) {
    for (const player of map.players) {
      const rows = players.get(player.player_id) ?? [];
      rows.push({ map, player });
      players.set(player.player_id, rows);
    }
  }
  return [...players.values()].map((rows) => ({
    player: rows[0].player,
    mapCount: rows.length,
    kills: rows.reduce((sum, { player }) => sum + player.kills, 0),
    deaths: rows.reduce((sum, { player }) => sum + player.deaths, 0),
    assists: rows.every(({ player }) => player.assists != null)
      ? rows.reduce((sum, { player }) => sum + (player.assists ?? 0), 0) : null,
    rating: roundAverage(rows, "rating"),
    swingscore: roundAverage(rows, "swingscore"),
    acs: roundAverage(rows, "acs"),
    adr: roundAverage(rows, "adr"),
    kast: roundAverage(rows, "kast"),
  })).sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.mapCount - a.mapCount);
}
