import type { Series } from "./events";

export type Team = "Blue" | "Red";

export type MatchSummary = {
  match_id: string;
  map_id: string;
  patch_version: string;
  ssversion: string;
  rating_version?: string | null;
  imported_at: string;
  played_at?: string | null;
  round_count: number;
  blue_score: number;
  red_score: number;
};

export type MatchPlayer = {
  player_id: string;
  display_name?: string | null;
  avatar_version?: string | null;
  agent_id: string;
  team_id: Team;
  kills: number;
  deaths: number;
  assists?: number | null;
  first_kills: number;
  kill_diff?: string | null;
  acs?: number | null;
  hs_percent?: number | null;
  first_deaths?: number | null;
  kast?: number | null;
  adr?: number | null;
  swingscore: number;
  rating?: number | null;
};

type PlayerIdentity = Pick<MatchPlayer, "player_id" | "display_name" | "avatar_version">;
export type ProfileEntry = PlayerIdentity & Pick<MatchPlayer, "agent_id"> & { match_count: number };
export type Leader = PlayerIdentity & Pick<MatchPlayer, "agent_id" | "swingscore"> &
  Pick<MatchSummary, "match_id" | "map_id">;
export type Overview = { matches: MatchSummary[]; leaders: Leader[]; profiles: ProfileEntry[]; round_count: number };
export type PlayerMatch = MatchSummary & Omit<MatchPlayer, keyof PlayerIdentity>;
export type Profile = PlayerIdentity & { matches: PlayerMatch[]; series?: Series[] };

type ReplayState = { attackers_alive: number; defenders_alive: number };
type EventType =
  | { type: "kill"; killer_id: string | null; victim_id: string }
  | { type: "revive"; target_id: string }
  | { type: "spike_planted"; site: string | null }
  | { type: "spike_defused" | "spike_exploded" };
export type RoundEvent = EventType & { time_ms: number; before: ReplayState; after: ReplayState };
export type Round = {
  result: {
    round_id: number;
    start_time_ms: number;
    buy_end_ms: number | null;
    end_time_ms: number | null;
    attacker_team_id: Team;
    defender_team_id: Team;
    winner_team_id: Team | null;
  };
  timeline: {
    initial_state: { attackers_loadout_value: number | null; defenders_loadout_value: number | null };
    events: RoundEvent[];
  };
};
export type MatchDetail = MatchSummary & { players: MatchPlayer[]; rounds: Round[] };

export const teamName = (team: Team) => (team === "Blue" ? "蓝方" : "红方");
export function score(value: number) {
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
}
export const ratingDescription = "VLTV 评分综合击杀、伤害、存活、KAST、多杀及回合影响，单场基准为 1.00。";
export const formatRating = (value: number | null | undefined) => value?.toFixed(2) ?? "—";

export function averageRating(matches: PlayerMatch[]) {
  let weighted = 0;
  let rounds = 0;
  for (const match of matches) {
    if (match.rating == null) continue;
    const completed = match.blue_score + match.red_score;
    weighted += match.rating * completed;
    rounds += completed;
  }
  return rounds ? weighted / rounds : null;
}

export const resultFor = (match: PlayerMatch) => {
  if (match.blue_score + match.red_score < match.round_count) return "未完赛";
  if (match.blue_score === match.red_score) return "平局";
  return (match.blue_score > match.red_score) === (match.team_id === "Blue") ? "胜利" : "失利";
};

const archiveDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
const archiveClock = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export const dateKey = (value: string) => archiveDate.format(new Date(value));
export const dateLabel = (value: string) => dateKey(value).replaceAll("-", ".");
export const timeLabel = (value: string) => archiveClock.format(new Date(value));
export const matchTime = (match: MatchSummary) => match.played_at ?? match.imported_at;
