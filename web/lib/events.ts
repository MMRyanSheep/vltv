import type { MatchSummary } from "./archive";

export const eventTiers = ["S", "A", "B", "C"] as const;
export type EventTier = (typeof eventTiers)[number];
export type EventInfo = { event_id: string; name: string; tier?: EventTier | null };
export type EventTeam = { team_id: string; name: string; tag: string; logo_version: string | null };
export type EventPlacement = { team_id: string; first_place: number; last_place: number };

export type SeriesMap = {
  slot: number;
  map_id: string | null;
  planned_map_id: string | null;
  replay_id: string | null;
  a_is_blue: boolean;
  score_a: number | null;
  score_b: number | null;
};

export const vetoLabels = {
  ban_a: "A 禁用", ban_b: "B 禁用", pick_a: "A 选用", pick_b: "B 选用", decider: "决胜图",
} as const;
type VetoAction = keyof typeof vetoLabels;
export type MapVeto = { action: VetoAction; map_id: string };

export type Series = {
  series_id: string;
  event_id: string;
  event_name: string;
  stage: string | null;
  starts_at: string;
  actual_starts_at?: string | null;
  best_of: 1 | 3 | 5;
  team_a: EventTeam;
  team_b: EventTeam;
  status: "scheduled" | "live" | "finished";
  score_a: number;
  score_b: number;
  maps: SeriesMap[];
  manual_score_a: number | null;
  manual_score_b: number | null;
  live: boolean;
};

export type SeriesDetail = Series & { veto: MapVeto[] };
export type EventDetail = EventInfo & { series: Series[]; placements: EventPlacement[] };
export type EventSchedule = { events: EventInfo[]; series: Series[] };
export type EventManagement = { events: EventInfo[]; teams: EventTeam[]; replays: MatchSummary[] };

export const seriesStatus = { scheduled: "未开始", live: "进行中", finished: "已结束" } as const;
export const seriesLiveWindowMs = 6 * 60 * 60 * 1000;

export function seriesStatusAt(series: Pick<Series, "status" | "starts_at">, now: number): Series["status"] {
  if (series.status !== "scheduled") return series.status;
  const elapsed = now - Date.parse(series.starts_at);
  return elapsed >= 0 && elapsed < seriesLiveWindowMs ? "live" : "scheduled";
}

const secondsPerDay = 86_400;

export function seriesCountdown(startsAt: string, now: number) {
  const remaining = Math.ceil((Date.parse(startsAt) - now) / 1000);
  if (remaining <= 0) return null;
  if (remaining > secondsPerDay) return `${Math.floor(remaining / secondsPerDay)}天`;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor(remaining / 60) % 60;
  const seconds = remaining % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export const eventHref = (id: string) => `/events/${encodeURIComponent(id)}`;
export const teamHref = (id: string) => `/teams/${encodeURIComponent(id)}`;
export const placementLabel = (first: number, last: number) =>
  first === last ? `第 ${first} 名` : `第 ${first}–${last} 名`;
export const seriesHref = (series: Pick<Series, "event_id" | "series_id">) =>
  `${eventHref(series.event_id)}/matches/${encodeURIComponent(series.series_id)}`;
