use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Team {
    Red,
    Blue,
}

impl Team {
    pub(crate) fn parse(name: &str) -> Option<Self> {
        match name {
            "Red" => Some(Self::Red),
            "Blue" => Some(Self::Blue),
            _ => None,
        }
    }

    pub(crate) fn opposite(self) -> Self {
        match self {
            Self::Red => Self::Blue,
            Self::Blue => Self::Red,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Player {
    pub player_id: String,
    pub team_id: Team,
    pub agent_id: String,
    #[serde(flatten)]
    pub stats: PlayerStats,
}

#[derive(Debug, Default, Serialize)]
pub struct PlayerStats {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kills: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deaths: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assists: Option<u32>,
    pub kill_diff: String,
    pub first_kills: u32,
    pub first_deaths: u32,
    pub kast: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hs_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adr: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct Match {
    pub match_id: String,
    pub map_id: String,
    pub patch_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub played_at: Option<String>,
    pub players: Vec<Player>,
    pub rounds: Vec<Round>,
}

#[derive(Debug, Serialize)]
pub struct Round {
    pub round_id: u32,
    pub start_time_ms: u32,
    pub buy_end_ms: Option<u32>,
    pub end_time_ms: Option<u32>,
    pub attacker_team_id: Team,
    pub defender_team_id: Team,
    pub winner_team_id: Option<Team>,
}

#[derive(Debug, Serialize)]
pub struct RoundTimeline {
    pub round_id: u32,
    pub initial_state: InitialState,
    pub events: Vec<Event>,
}

#[derive(Debug, Serialize)]
pub struct InitialState {
    #[serde(flatten)]
    pub state: State,
    pub attackers_loadout_value: Option<i64>,
    pub defenders_loadout_value: Option<i64>,
    pub attackers_loadout_time_ms: Option<u32>,
    pub defenders_loadout_time_ms: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct State {
    pub attackers_alive: usize,
    pub defenders_alive: usize,
    pub spike_planted: bool,
    pub spike_status: SpikeStatus,
    pub spike_remaining_ms: Option<u32>,
    pub remaining_time_ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpikeStatus {
    Unplanted,
    Planted,
    Defused,
    Exploded,
}

#[derive(Debug, Serialize)]
pub struct Event {
    pub time_ms: u32,
    #[serde(flatten)]
    pub kind: EventKind,
    pub before: State,
    pub after: State,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventKind {
    Kill {
        killer_id: Option<String>,
        victim_id: String,
        #[serde(skip_serializing_if = "BTreeMap::is_empty")]
        damage_by_player: BTreeMap<String, f64>,
    },
    Revive {
        target_id: String,
    },
    SpikePlanted {
        site: Option<String>,
    },
    SpikeDefused,
    SpikeExploded,
}
