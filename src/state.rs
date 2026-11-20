use std::collections::HashMap;

use anyhow::{Result, ensure};

use crate::model::{Event, EventKind, Player, SpikeStatus, State, Team};

pub(crate) struct Rebuilder<'a> {
    players: HashMap<&'a str, (Team, bool)>,
    attacker: Team,
    spike_status: SpikeStatus,
    spike_deadline: Option<u32>,
}

impl<'a> Rebuilder<'a> {
    pub fn new(players: impl Iterator<Item = &'a Player>, attacker: Team) -> Self {
        Self {
            players: players
                .map(|p| (p.player_id.as_str(), (p.team_id, true)))
                .collect(),
            attacker,
            spike_status: SpikeStatus::Unplanted,
            spike_deadline: None,
        }
    }

    pub fn snapshot(&self, time_ms: u32, round_deadline: Option<u32>) -> State {
        let mut attackers_alive = 0;
        let mut defenders_alive = 0;
        for &(team, alive) in self.players.values() {
            if alive {
                if team == self.attacker {
                    attackers_alive += 1;
                } else {
                    defenders_alive += 1;
                }
            }
        }
        let spike_remaining_ms = match self.spike_status {
            SpikeStatus::Unplanted => None,
            SpikeStatus::Planted => self.spike_deadline.map(|due| due.saturating_sub(time_ms)),
            SpikeStatus::Defused | SpikeStatus::Exploded => Some(0),
        };
        State {
            attackers_alive,
            defenders_alive,
            spike_planted: self.spike_status == SpikeStatus::Planted,
            spike_status: self.spike_status,
            spike_remaining_ms,
            remaining_time_ms: if self.spike_status == SpikeStatus::Unplanted {
                round_deadline.map(|due| due.saturating_sub(time_ms))
            } else {
                spike_remaining_ms
            },
        }
    }

    pub fn apply(
        &mut self,
        time_ms: u32,
        kind: EventKind,
        round_deadline: Option<u32>,
        spike_deadline: Option<u32>,
    ) -> Result<Event> {
        let before = self.snapshot(time_ms, round_deadline);
        match &kind {
            EventKind::Kill { victim_id, .. } => self.set_alive(victim_id, false)?,
            EventKind::Revive { target_id } => self.set_alive(target_id, true)?,
            EventKind::SpikePlanted { .. } => {
                ensure!(
                    self.spike_status == SpikeStatus::Unplanted,
                    "duplicate Spike plant"
                );
                self.spike_status = SpikeStatus::Planted;
                self.spike_deadline = spike_deadline;
            }
            EventKind::SpikeDefused | EventKind::SpikeExploded => {
                ensure!(
                    self.spike_status == SpikeStatus::Planted,
                    "Spike resolved without a plant"
                );
                self.spike_status = if matches!(kind, EventKind::SpikeDefused) {
                    SpikeStatus::Defused
                } else {
                    SpikeStatus::Exploded
                };
            }
        }
        Ok(Event {
            time_ms,
            kind,
            before,
            after: self.snapshot(time_ms, round_deadline),
        })
    }

    fn set_alive(&mut self, player: &str, alive: bool) -> Result<()> {
        let (_, current) = self
            .players
            .get_mut(player)
            .ok_or_else(|| anyhow::anyhow!("player {player} is absent at round start"))?;
        ensure!(
            *current != alive,
            "unexpected life transition for {player}: alive={alive}"
        );
        *current = alive;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kill_plant_revive_kill_and_defuse_at_global_times() -> Result<()> {
        let player = Player {
            player_id: "p".into(),
            team_id: Team::Blue,
            agent_id: "a".into(),
            stats: Default::default(),
        };
        let mut state = Rebuilder::new([&player].into_iter(), Team::Red);
        let kill = || EventKind::Kill {
            victim_id: "p".into(),
            killer_id: None,
            damage_by_player: Default::default(),
        };

        let death = state.apply(145_000, kill(), Some(230_000), None)?;
        assert_eq!(death.before.defenders_alive, 1);
        assert_eq!(death.after.defenders_alive, 0);
        assert_eq!(death.after.remaining_time_ms, Some(85_000));
        assert!(state.apply(145_001, kill(), None, None).is_err());

        let plant = state.apply(
            180_000,
            EventKind::SpikePlanted {
                site: Some("A".into()),
            },
            Some(230_000),
            Some(225_000),
        )?;
        assert_eq!(plant.before.spike_remaining_ms, None);
        assert_eq!(plant.after.spike_remaining_ms, Some(45_000));

        let revive = state.apply(
            190_000,
            EventKind::Revive {
                target_id: "p".into(),
            },
            None,
            None,
        )?;
        assert_eq!(revive.before.defenders_alive, 0);
        assert_eq!(revive.after.defenders_alive, 1);
        assert_eq!(revive.before.spike_remaining_ms, Some(35_000));
        assert_eq!(revive.after.spike_remaining_ms, Some(35_000));
        assert_eq!(
            state
                .apply(195_000, kill(), None, None)?
                .after
                .defenders_alive,
            0
        );

        let defuse = state.apply(200_000, EventKind::SpikeDefused, None, None)?;
        assert_eq!(defuse.before.spike_remaining_ms, Some(25_000));
        assert_eq!(defuse.after.spike_remaining_ms, Some(0));
        assert_eq!(defuse.after.spike_status, SpikeStatus::Defused);
        Ok(())
    }
}
