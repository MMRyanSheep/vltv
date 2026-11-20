use std::collections::{BTreeMap, HashMap};

use parquet::record::Row;

use crate::{
    model::{Round, Team},
    tables::{Column, Stamp, array_member},
};

#[derive(Default)]
pub(crate) struct ReplicatedStats {
    pub scores: HashMap<u32, (Stamp, u32)>,
    pub assists: HashMap<u32, Vec<(Stamp, u32)>>,
    scoreboard: HashMap<u32, Scoreboard>,
    player_info: HashMap<u32, u32>,
    reports: HashMap<u32, BTreeMap<u32, ReportRound>>,
}

#[derive(Default)]
struct Scoreboard {
    kills: Option<(Stamp, u32)>,
    deaths: Option<(Stamp, u32)>,
    assists: Option<(Stamp, u32)>,
}

#[derive(Default)]
struct ReportRound {
    number: Option<u32>,
    interactions: BTreeMap<(u32, u32), Interaction>,
}

#[derive(Default)]
struct Interaction {
    team: Option<Team>,
    damage: Option<f64>,
    regions: BTreeMap<(u32, u32), HitRegion>,
}

#[derive(Default)]
struct HitRegion {
    region: Option<u32>,
    hits: u32,
}

impl ReplicatedStats {
    pub fn field(&mut self, stamp: Stamp, actor: u32, group: &str, name: &str, row: &Row) {
        match (group, name) {
            ("/Script/ShooterGame.PlayerScoreComponent", "Score") => {
                if let Some(score) = row.u32("value_i64") {
                    let latest = self.scores.entry(actor).or_default();
                    *latest = (*latest).max((stamp, score));
                }
            }
            (
                "/Script/ShooterGame.BasicCombatStatsComponent",
                "AggregateKills" | "AggregateDeaths" | "AggregateAssists",
            ) => {
                let Some(value) = row.u32("value_i64") else {
                    return;
                };
                let scoreboard = self.scoreboard.entry(actor).or_default();
                let counter = match name {
                    "AggregateKills" => &mut scoreboard.kills,
                    "AggregateDeaths" => &mut scoreboard.deaths,
                    _ => {
                        self.assists.entry(actor).or_default().push((stamp, value));
                        &mut scoreboard.assists
                    }
                };
                *counter = (*counter).max(Some((stamp, value)));
            }
            (_, "PlayerInfo") if group.ends_with("PlayerState_C") => {
                if let Some(info) = row.u32("value_i64").filter(|&info| info != 0) {
                    self.player_info.insert(actor, info);
                }
            }
            _ if group.ends_with(".Bomb_CombatReportComponent_C") => {
                self.report_field(actor, name, row);
            }
            _ => {}
        }
    }

    pub fn scoreboard_totals(&self, states: &[u32]) -> Option<(u32, u32, u32)> {
        let mut totals = Scoreboard::default();
        let mut observed = false;
        for state in states.iter().filter_map(|state| self.scoreboard.get(state)) {
            observed = true;
            totals.kills = totals.kills.max(state.kills);
            totals.deaths = totals.deaths.max(state.deaths);
            totals.assists = totals.assists.max(state.assists);
        }
        // The replay replicates changes to these counters. Unchanged counters stay at zero.
        observed.then(|| {
            (
                totals.kills.map_or(0, |(_, value)| value),
                totals.deaths.map_or(0, |(_, value)| value),
                totals.assists.map_or(0, |(_, value)| value),
            )
        })
    }

    pub fn finish(&mut self) {
        for updates in self.assists.values_mut() {
            updates.sort_unstable();
            let mut previous = 0;
            updates.retain(|&(_, value)| {
                let increased = value > previous;
                previous = value;
                increased
            });
        }
    }

    fn report_field(&mut self, actor: u32, name: &str, row: &Row) {
        let Some((slot, member)) = array_member(name, "Rounds[") else {
            return;
        };
        let round = self
            .reports
            .entry(actor)
            .or_default()
            .entry(slot)
            .or_default();
        if member == "RoundNum" {
            round.number = row.u32("value_i64");
            return;
        }
        let Some((report, member)) = array_member(member, "Reports[") else {
            return;
        };
        let Some((index, member)) = array_member(member, "Interactions[") else {
            return;
        };
        // These rows update cumulative values at the same array index.
        let interaction = round.interactions.entry((report, index)).or_default();
        match member {
            "ParticipantTeamName" => interaction.team = row.text("value_str").and_then(Team::parse),
            "DamageDealt" => interaction.damage = row.double("value_f64"),
            _ => {
                if let Some((source, member)) = array_member(member, "DealtInteractions[")
                    && let Some((region, field)) =
                        array_member(member, "RegionalDamageInteractions[")
                {
                    let hit = interaction.regions.entry((source, region)).or_default();
                    match field {
                        "Region" => hit.region = row.u32("value_i64"),
                        "Hits" => hit.hits = row.u32("value_i64").unwrap_or_default(),
                        _ => {}
                    }
                }
            }
        }
    }

    pub fn damage_and_hits(
        &self,
        states: &[u32],
        team: Team,
        rounds: &[Round],
    ) -> Option<(f64, u32, u32)> {
        let reports: Vec<_> = states
            .iter()
            .filter_map(|state| self.player_info.get(state))
            .filter_map(|info| self.reports.get(info))
            .collect();
        let (mut damage, mut headshots, mut hits) = (0.0, 0, 0);
        for round in rounds {
            let report = reports
                .iter()
                .flat_map(|report| report.values())
                .find(|report| report.number == Some(round.round_id - 1))?;
            for interaction in report.interactions.values() {
                if interaction.team != Some(team.opposite()) {
                    continue;
                }
                damage += interaction.damage?;
                for hit in interaction.regions.values() {
                    match hit.region {
                        Some(1) => {
                            headshots += hit.hits;
                            hits += hit.hits;
                        }
                        Some(0 | 2) => hits += hit.hits,
                        _ => {}
                    }
                }
            }
        }
        Some((damage, headshots, hits))
    }
}
