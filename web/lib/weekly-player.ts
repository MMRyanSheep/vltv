export type WeeklySelection = {
  player_id: string;
  display_name: string | null;
  agent_id: string | null;
  reason: string;
  highlight: string | null;
};

export type WeeklyPlayer = {
  week_start: string;
  selection: WeeklySelection | null;
};

export type WeeklyCategory = "impact" | "damage" | "opening" | "assists" | "participation";

export type WeeklyCandidate = {
  player_id: string;
  value: number;
  match_count: number;
  round_count: number;
};

export type WeeklyReview = WeeklyPlayer & {
  stats: {
    match_count: number;
    round_count: number;
    candidates: Partial<Record<WeeklyCategory, WeeklyCandidate[]>>;
  };
};
