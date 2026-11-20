import type { MatchDetail, MatchPlayer, Team } from "./archive";
import type { SeriesMap } from "./events";

export function orientReplay(replay: MatchDetail, map: SeriesMap): MatchDetail {
  if (map.a_is_blue) return replay;
  return {
    ...replay,
    blue_score: replay.red_score,
    red_score: replay.blue_score,
    players: replay.players.map((player) => ({ ...player, team_id: player.team_id === "Blue" ? "Red" : "Blue" })),
  };
}

type Appearance = { match: MatchDetail; player: MatchPlayer };

export function summarizeSeries(matches: MatchDetail[]) {
  const lineups = new Map<string, Appearance[]>();
  for (const match of matches) {
    for (const player of match.players) {
      const appearances = lineups.get(player.player_id);
      if (appearances) appearances.push({ match, player });
      else lineups.set(player.player_id, [{ match, player }]);
    }
  }
  const roundCounts: Record<string, number> = {};
  const agentIds: Record<string, string[]> = {};
  const players = [...lineups.values()].map((appearances): MatchPlayer => {
    const { player } = appearances[appearances.length - 1];
    roundCounts[player.player_id] = appearances.reduce((sum, { match }) => sum + match.round_count, 0);
    agentIds[player.player_id] = [...new Set(appearances.map(({ player }) => player.agent_id))];
    return {
      ...player,
      kills: total(appearances, "kills"),
      deaths: total(appearances, "deaths"),
      assists: total(appearances, "assists"),
      first_kills: total(appearances, "first_kills"),
      first_deaths: total(appearances, "first_deaths"),
      kill_diff: null,
      acs: average(appearances, "acs"),
      adr: average(appearances, "adr"),
      kast: average(appearances, "kast"),
      hs_percent: appearances.length === 1 ? player.hs_percent : null,
      swingscore: average(appearances, "swingscore") ?? 0,
      rating: average(appearances, "rating"),
    };
  }).sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.swingscore - a.swingscore || b.kills - a.kills);
  const version = (key: "ssversion" | "rating_version") =>
    matches.every((match) => match[key] === matches[0]?.[key]) ? matches[0]?.[key] ?? "" : "";
  return {
    players, roundCounts, agentIds,
    ssversion: version("ssversion"), rating_version: version("rating_version"),
    rounds: matches.flatMap((match) => match.rounds),
    round_count: matches.reduce((sum, match) => sum + match.round_count, 0),
  };
}

function total(rows: Appearance[], metric: "kills" | "deaths" | "first_kills"): number;
function total(rows: Appearance[], metric: "assists" | "first_deaths"): number | null;
function total(rows: Appearance[], metric: "kills" | "deaths" | "first_kills" | "assists" | "first_deaths") {
  let sum = 0;
  for (const { player } of rows) {
    const value = player[metric];
    if (value == null) return null;
    sum += value;
  }
  return sum;
}

function average(rows: Appearance[], metric: "acs" | "adr" | "kast" | "swingscore" | "rating") {
  let sum = 0;
  let rounds = 0;
  for (const { match, player } of rows) {
    const count = metric === "rating" ? match.blue_score + match.red_score : match.round_count;
    if (!count) continue;
    const value = player[metric];
    if (value == null) {
      if (metric === "rating") continue;
      return null;
    }
    sum += value * count;
    rounds += count;
  }
  return rounds ? sum / rounds : null;
}
