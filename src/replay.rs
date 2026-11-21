use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::File,
    path::Path,
};

use anyhow::{Context, Result, bail, ensure};
use chrono::{DateTime, Datelike, SecondsFormat};
use parquet::record::Row;
use serde::Deserialize;

use crate::{
    damage::{DamageEvidence, DamageHit},
    model::{EventKind, InitialState, Match, Player, PlayerStats, Round, RoundTimeline, Team},
    state::Rebuilder,
    stats::ReplicatedStats,
    tables::{Column, Stamp, array_member, read_rows},
};

#[derive(Deserialize)]
struct Manifest {
    friendly_name: String,
    replay_build: String,
    timestamp_ticks: Option<i64>,
    level_names_and_times: Vec<Level>,
    game_specific_data: Vec<String>,
    players: Vec<Identity>,
    quality: ManifestQuality,
}

#[derive(Deserialize)]
struct ManifestQuality {
    content_blocks_lost: u64,
    replay_data_trailing_bytes: u64,
    event_layout_mismatches: u64,
}

#[derive(Deserialize)]
struct Level {
    name: String,
}

#[derive(Deserialize)]
struct Identity {
    actor_net_guid: u32,
    subject: Option<String>,
    character_net_guids: Vec<u32>,
}

#[derive(Deserialize)]
struct LoadoutHeader {
    #[serde(rename = "playerLoadouts")]
    loadouts: Vec<Loadout>,
}

#[derive(Deserialize)]
struct Loadout {
    subject: String,
    #[serde(rename = "characterId")]
    agent: String,
}

#[derive(Default)]
struct Evidence {
    damage: DamageEvidence,
    stats: ReplicatedStats,
    team_components: HashMap<u32, u32>,
    assigned_teams: BTreeMap<u32, Vec<(Stamp, u32)>>,
    bodies: HashMap<u32, Vec<(Stamp, u32)>>,
    loadouts: HashMap<u32, Vec<(Stamp, i64)>>,
    phases: Vec<(Stamp, i64)>,
    results: HashMap<u32, RoundResult>,
    round_clock: Vec<(u32, u32)>,
    bombs: HashMap<u32, Bomb>,
    events: Vec<RawEvent>,
    round_starts: Vec<(u32, u32)>,
    side_switches: Vec<u32>,
}

#[derive(Debug, Default)]
struct RoundResult {
    number: Option<u32>,
    winner: Option<Team>,
    winner_attacks: Option<bool>,
}

#[derive(Default)]
struct Bomb {
    clock: Vec<(u32, u32)>,
    site: Option<i64>,
}

#[derive(Clone, Copy)]
enum RawKind {
    Kill(u32, u32),
    Revive(u32),
    Plant,
    Defuse,
    Explode,
}

struct RawEvent {
    time: u32,
    // Event chunks retain server order at an equal time. Field-only revives
    // follow event chunks at that same millisecond.
    source_order: (bool, usize),
    kind: RawKind,
}

#[derive(Default)]
struct RoundPhase {
    start: u32,
    buy_end: Option<Stamp>,
    end: Option<u32>,
}

impl Evidence {
    fn read(path: &Path) -> Result<Self> {
        let mut data = Self::default();
        read_rows(
            path,
            "fields.parquet",
            &[
                "time_ms",
                "packet_id",
                "actor_net_guid",
                "group_path",
                "field_name",
                "value_i64",
                "value_f64",
                "value_bool",
                "value_str",
            ],
            |index, row| data.field(index, row),
        )?;
        read_rows(
            path,
            "events.parquet",
            &["time1", "group", "word0", "word1"],
            |index, row| data.event(index, row),
        )?;

        data.events.sort_by_key(|e| (e.time, e.source_order));
        data.round_starts.sort_unstable();
        data.side_switches.sort_unstable();
        data.phases.sort_unstable();
        data.round_clock.sort_by_key(|sample| sample.0);
        for updates in data.loadouts.values_mut() {
            updates.sort_by_key(|update| update.0);
        }
        for updates in data.bodies.values_mut() {
            updates.sort_by_key(|update| update.0);
        }
        for updates in data.assigned_teams.values_mut() {
            updates.sort_by_key(|update| update.0);
        }
        for bomb in data.bombs.values_mut() {
            bomb.clock.sort_by_key(|sample| sample.0);
        }
        data.damage.finish();
        data.stats.finish();
        Ok(data)
    }

    fn field(&mut self, index: usize, row: Row) -> Result<()> {
        let Some(name) = row.text("field_name") else {
            return Ok(());
        };
        let group = row.text("group_path").unwrap_or_default();
        let time = row.u32("time_ms").context("missing field time")?;
        let actor = row.u32("actor_net_guid").context("missing field actor")?;
        let stamp = (time, index);
        if name.starts_with("MulticastNotifyDamage_") {
            self.damage.field(stamp, actor, name, &row);
            return Ok(());
        }
        match name {
            "MulticastSetPhase.NewPhase" if is_bomb_game_state(group) => {
                if let Some(phase) = row.integer("value_i64") {
                    self.phases.push((stamp, phase));
                }
            }
            "StateRemainingTime" if is_bomb_game_state(group) => {
                if let Some(remaining) = row.double("value_f64").and_then(milliseconds) {
                    self.round_clock.push((time, remaining));
                }
            }
            "TeamComponent" if group == "/Script/ShooterGame.BaseTeamState" => {
                let component = row
                    .u32("value_i64")
                    .context("untyped BaseTeamState.TeamComponent; use the patched vrfkit")?;
                if component != 0 {
                    self.team_components.insert(actor, component);
                }
            }
            "AssignedTeamState" if group.ends_with("PlayerState_C") => {
                let assigned = row
                    .u32("value_i64")
                    .context("untyped player AssignedTeamState; use the patched vrfkit")?;
                if assigned != 0 {
                    self.assigned_teams
                        .entry(actor)
                        .or_default()
                        .push((stamp, assigned));
                }
            }
            "SpawnedCharacter" if group.ends_with("PlayerState_C") => {
                if let Some(body) = row.u32("value_i64") {
                    self.bodies.entry(actor).or_default().push((stamp, body));
                }
            }
            "LoadoutValue" if group == "/Script/ShooterGame.BaseTeamState" => {
                if let Some(value) = row.integer("value_i64") {
                    self.loadouts.entry(actor).or_default().push((stamp, value));
                }
            }
            "MulticastReceivePlayerResurrectEvent.ResurrectedPlayer"
                if is_bomb_game_state(group) =>
            {
                let subject = row
                    .u32("value_i64")
                    .context("resurrection target was not decoded")?;
                self.events.push(RawEvent {
                    time,
                    source_order: (true, index),
                    kind: RawKind::Revive(subject),
                });
            }
            "TimeRemainingToExplode" if group.ends_with(".TimedBomb_C") => {
                if let Some(remaining) = row.double("value_f64").and_then(milliseconds) {
                    self.bombs
                        .entry(actor)
                        .or_default()
                        .clock
                        .push((time, remaining));
                }
            }
            "PlantedAtSite" if group.ends_with(".TimedBomb_C") => {
                self.bombs.entry(actor).or_default().site = row.integer("value_i64");
            }
            _ if is_bomb_game_state(group) => {
                if let Some((slot, member)) = array_member(name, "RoundResults[") {
                    let result = self.results.entry(slot).or_default();
                    match member {
                        "RoundNumber" => result.number = row.u32("value_i64"),
                        "WinningTeam" => {
                            result.winner = row.text("value_str").and_then(Team::parse)
                        }
                        "WinningTeamRole" => {
                            result.winner_attacks = match row.text("value_str") {
                                Some("attacker") => Some(true),
                                Some("defender") => Some(false),
                                _ => None,
                            };
                        }
                        _ => {}
                    }
                }
            }
            _ => self.stats.field(stamp, actor, group, name, &row),
        }
        Ok(())
    }

    fn event(&mut self, index: usize, row: Row) -> Result<()> {
        let time = row.u32("time1").context("missing Event time1")?;
        let kind = match row.text("group") {
            Some("roundStarted") => {
                self.round_starts
                    .push((time, row.u32("word0").context("untyped roundStarted")?));
                return Ok(());
            }
            Some("switchTeams") => {
                self.side_switches.push(time);
                return Ok(());
            }
            Some("characterDeath") => RawKind::Kill(
                row.u32("word0").context("untyped killer NetGUID")?,
                row.u32("word1").context("untyped victim NetGUID")?,
            ),
            Some("spikePlanted") => RawKind::Plant,
            Some("spikeDefused") => RawKind::Defuse,
            Some("spikeExploded") => RawKind::Explode,
            _ => return Ok(()),
        };
        self.events.push(RawEvent {
            time,
            source_order: (false, index),
            kind,
        });
        Ok(())
    }

    fn phases_by_round(&self) -> Vec<RoundPhase> {
        let mut rounds: Vec<RoundPhase> = Vec::new();
        for &(stamp, phase) in &self.phases {
            if phase == 3 {
                if rounds.last().is_none_or(|round| round.start != stamp.0) {
                    rounds.push(RoundPhase {
                        start: stamp.0,
                        ..Default::default()
                    });
                }
            } else if let Some(round) = rounds.last_mut() {
                match phase {
                    4 => {
                        round.buy_end.get_or_insert(stamp);
                    }
                    5 => {
                        round.end.get_or_insert(stamp.0);
                    }
                    _ => {}
                }
            }
        }
        rounds
    }

    fn plant(&self, time: u32, explosion: Option<u32>) -> (Option<String>, Option<u32>) {
        // The TimedBomb channel opens with the initial, positive fuse value.
        // Its frame follows the corresponding Event chunk by a few milliseconds.
        let bomb = self
            .bombs
            .values()
            .filter_map(|bomb| bomb.clock.first().map(|sample| (sample, bomb)))
            .filter(|((stamp, _), _)| stamp.abs_diff(time) <= 100)
            .min_by_key(|((stamp, _), _)| stamp.abs_diff(time));
        let Some((&(_, fuse), bomb)) = bomb else {
            return (None, explosion);
        };
        let site = match bomb.site.unwrap_or(0) {
            0 => Some("A".to_owned()),
            1 => Some("B".to_owned()),
            2 => Some("C".to_owned()),
            _ => None,
        };
        (site, explosion.or_else(|| time.checked_add(fuse)))
    }
}

fn is_bomb_game_state(group: &str) -> bool {
    group.ends_with(".BombGameState_C") || group.ends_with(".BombGameState_C_ClassNetCache")
}

fn milliseconds(seconds: f64) -> Option<u32> {
    let ms = (seconds * 1000.0).round();
    (0.0..=f64::from(u32::MAX))
        .contains(&ms)
        .then_some(ms as u32)
}

fn read_team_guids(path: &Path) -> Result<HashMap<u32, Team>> {
    let mut teams = HashMap::new();
    read_rows(
        path,
        "net_guids.parquet",
        &["net_guid", "path"],
        |_, row| {
            let team = match row.text("path") {
                Some("RedTeam") => Team::Red,
                Some("BlueTeam") => Team::Blue,
                _ => return Ok(()),
            };
            teams.insert(row.u32("net_guid").context("missing team NetGUID")?, team);
            Ok(())
        },
    )?;
    Ok(teams)
}

struct Roster {
    players: Vec<Player>,
    by_guid: HashMap<u32, usize>,
    state_guids: Vec<Vec<u32>>,
}

impl Roster {
    fn build(manifest: &Manifest, evidence: &Evidence, teams: &HashMap<u32, Team>) -> Result<Self> {
        let mut agents = HashMap::new();
        for header in &manifest.game_specific_data {
            if let Ok(header) = serde_json::from_str::<LoadoutHeader>(header) {
                agents.extend(header.loadouts.into_iter().map(|loadout| {
                    (
                        loadout.subject.to_ascii_lowercase(),
                        loadout.agent.to_ascii_lowercase(),
                    )
                }));
            }
        }
        let mut roster = Self {
            players: Vec::new(),
            by_guid: HashMap::new(),
            state_guids: Vec::new(),
        };
        let mut by_subject = HashMap::new();
        for id in &manifest.players {
            let Some(subject) = id.subject.as_ref().map(|s| s.to_ascii_lowercase()) else {
                continue;
            };
            let agent_id = agents.get(&subject);
            // Observers can have a team assignment but no agent or character.
            if agent_id.is_some_and(String::is_empty) && id.character_net_guids.is_empty() {
                continue;
            }
            let state = id.actor_net_guid;
            let assigned = evidence
                .assigned_teams
                .get(&state)
                .with_context(|| format!("no assigned team for player state {state}"))?;
            let team = teams
                .get(&assigned[0].1)
                .copied()
                .context("unresolved player team")?;
            ensure!(
                assigned
                    .iter()
                    .all(|(_, state)| teams.get(state) == Some(&team)),
                "player {subject} changed team allegiance"
            );
            let index = if let Some(&index) = by_subject.get(&subject) {
                ensure!(
                    roster
                        .players
                        .get(index)
                        .is_some_and(|p: &Player| p.team_id == team),
                    "reconnected player {subject} changed team allegiance"
                );
                index
            } else {
                let agent_id = agent_id
                    .with_context(|| format!("missing agent ID for {subject}"))?
                    .clone();
                let index = roster.players.len();
                roster.players.push(Player {
                    player_id: subject.clone(),
                    team_id: team,
                    agent_id,
                    stats: PlayerStats::default(),
                });
                roster.state_guids.push(Vec::new());
                by_subject.insert(subject, index);
                index
            };
            roster.state_guids[index].push(state);
            for guid in std::iter::once(state).chain(id.character_net_guids.iter().copied()) {
                let old = roster.by_guid.insert(guid, index);
                ensure!(
                    old.is_none_or(|old| old == index),
                    "ambiguous player NetGUID {guid}"
                );
            }
        }
        ensure!(!roster.players.is_empty(), "no players with a subject");
        Ok(roster)
    }

    fn id(&self, guid: u32) -> Option<String> {
        self.by_guid
            .get(&guid)
            .map(|index| self.players[*index].player_id.clone())
    }

    fn kill_damage(
        &self,
        hits: &[&DamageHit],
        killer: u32,
        victim: usize,
        life_start: u32,
        death_time: u32,
    ) -> BTreeMap<String, f64> {
        // The damage RPC and the characterDeath chunk have different replay clocks.
        const DEATH_MATCH_MS: u32 = 100;
        let team = self.players[victim].team_id.opposite();
        let Some(&killer) = self
            .by_guid
            .get(&killer)
            .filter(|&&i| self.players[i].team_id == team)
        else {
            return BTreeMap::new();
        };
        let begin = hits.partition_point(|hit| hit.stamp.0 < life_start);
        let hits = &hits[begin..];
        let near_death =
            hits.partition_point(|hit| hit.stamp.0 < death_time.saturating_sub(DEATH_MATCH_MS));
        let mut lethal_hits = hits
            .iter()
            .enumerate()
            .skip(near_death)
            .take_while(|(_, hit)| hit.stamp.0 <= death_time.saturating_add(DEATH_MATCH_MS))
            .filter(|(_, hit)| hit.lethal);
        let Some((end, lethal)) = lethal_hits.next() else {
            return BTreeMap::new();
        };
        if lethal_hits.next().is_some()
            || self.by_guid.get(&lethal.kill_credit) != Some(&killer)
            || self.by_guid.get(&lethal.damager) != Some(&killer)
        {
            return BTreeMap::new();
        }

        let mut damage = BTreeMap::new();
        for hit in &hits[..=end] {
            if hit.victim != lethal.victim || hit.respawn != lethal.respawn {
                continue;
            }
            if let Some(&index) = self.by_guid.get(&hit.damager)
                && self.players[index].team_id == team
            {
                *damage
                    .entry(self.players[index].player_id.clone())
                    .or_default() += hit.amount;
            }
        }
        damage
    }
}

#[derive(Clone, Default)]
struct CombatTotals {
    kills: i32,
    deaths: i32,
    first_kills: u32,
    first_deaths: u32,
    kast_rounds: u32,
    played: u32,
}

fn record_round_stats(
    totals: &mut [CombatTotals],
    roster: &Roster,
    stats: &ReplicatedStats,
    round: &Round,
    next_round_start: u32,
    events: &[RawEvent],
    active: &[bool],
) {
    const TRADE_WINDOW_MS: u32 = 5_000;
    let end = round
        .end_time_ms
        .unwrap_or(next_round_start.saturating_sub(1));
    let mut alive = active.to_vec();
    let mut contributed = vec![false; active.len()];
    let mut enemy_kills = Vec::<(u32, usize, usize)>::new();
    for event in events.iter().take_while(|event| event.time <= end) {
        match event.kind {
            RawKind::Kill(killer, victim) => {
                let victim = roster.by_guid[&victim];
                alive[victim] = false;
                totals[victim].deaths += 1;
                let Some(&killer) = roster.by_guid.get(&killer) else {
                    continue;
                };
                if roster.players[killer].team_id == roster.players[victim].team_id {
                    continue;
                }
                totals[killer].kills += 1;
                contributed[killer] = true;
                if enemy_kills.is_empty() {
                    totals[killer].first_kills += 1;
                    totals[victim].first_deaths += 1;
                }
                for &(time, attacker, teammate) in enemy_kills.iter().rev() {
                    if event.time - time > TRADE_WINDOW_MS {
                        break;
                    }
                    if attacker == victim {
                        contributed[teammate] = true;
                    }
                }
                enemy_kills.push((event.time, killer, victim));
            }
            RawKind::Revive(target) => alive[roster.by_guid[&target]] = true,
            _ => {}
        }
    }
    for (index, total) in totals.iter_mut().enumerate() {
        if active[index] {
            let assisted = roster.state_guids[index]
                .iter()
                .filter_map(|state| stats.assists.get(state))
                .flatten()
                .any(|&((time, _), _)| (round.start_time_ms..=end).contains(&time));
            total.played += 1;
            total.kast_rounds += u32::from(contributed[index] || alive[index] || assisted);
        }
    }
}

fn map_name(code: &str) -> &str {
    match code {
        "Bonsai" => "Split",
        "Canyon" => "Fracture",
        "Duality" => "Bind",
        "Foxtrot" => "Breeze",
        "Infinity" => "Abyss",
        "Jam" => "Lotus",
        "Juliett" => "Sunset",
        "Pitt" => "Pearl",
        "Port" => "Icebox",
        "Triad" => "Haven",
        _ => code,
    }
}

fn replay_time(ticks: i64) -> Option<String> {
    // Unreal FDateTime uses 100 ns ticks since 0001-01-01. VALORANT replay times use UTC.
    const UNIX_EPOCH_TICKS: i64 = 621_355_968_000_000_000;
    let ticks_since_epoch = ticks
        .checked_sub(UNIX_EPOCH_TICKS)
        .filter(|&ticks| ticks >= 0)?;
    DateTime::from_timestamp_millis(ticks_since_epoch / 10_000)
        .filter(|time| time.year() <= 9999)
        .map(|time| time.to_rfc3339_opts(SecondsFormat::Millis, true))
}

pub(crate) fn reconstruct(
    path: &Path,
    match_id: Option<&str>,
) -> Result<(Match, Vec<RoundTimeline>)> {
    let manifest: Manifest = serde_json::from_reader(File::open(path.join("manifest.json"))?)?;
    let quality = &manifest.quality;
    ensure!(
        quality.content_blocks_lost == 0
            && quality.replay_data_trailing_bytes == 0
            && quality.event_layout_mismatches == 0,
        "vrfkit reported incomplete evidence: {} lost content blocks, {} unread replay bytes, {} event layout mismatches",
        quality.content_blocks_lost,
        quality.replay_data_trailing_bytes,
        quality.event_layout_mismatches
    );
    let evidence = Evidence::read(path)?;
    let team_guids = read_team_guids(path)?;
    let teams: HashMap<u32, Team> = evidence
        .team_components
        .iter()
        .filter_map(|(&state, component)| team_guids.get(component).map(|&name| (state, name)))
        .collect();
    let mut roster = Roster::build(&manifest, &evidence, &teams)?;
    let mut victim_hits = vec![Vec::new(); roster.players.len()];
    let mut seen_hits = HashSet::new();
    for hit in &evidence.damage.hits {
        if let Some(&index) = roster.by_guid.get(&hit.victim)
            && seen_hits.insert((hit.victim, hit.respawn, hit.life_change_index))
        {
            victim_hits[index].push(hit);
        }
    }
    let mut totals = vec![CombatTotals::default(); roster.players.len()];
    let phases = evidence.phases_by_round();
    let results: HashMap<u32, &RoundResult> = evidence
        .results
        .values()
        .filter_map(|result| result.number.map(|number| (number, result)))
        .collect();
    ensure!(
        !evidence.round_starts.is_empty(),
        "no played bomb-mode rounds"
    );

    let match_id = match_id
        .unwrap_or(manifest.friendly_name.as_str())
        .to_owned();
    ensure!(!match_id.is_empty(), "missing match ID");
    let map_code = manifest
        .level_names_and_times
        .iter()
        .find_map(|level| level.name.strip_prefix("/Game/Maps/")?.split('/').next())
        .context("map identifier missing from replay header")?;
    let patch = manifest
        .replay_build
        .rsplit('-')
        .next()
        .filter(|suffix| suffix.contains('.'))
        .context("missing game patch")?;
    let mut summary = Match {
        match_id,
        map_id: map_name(map_code).to_owned(),
        patch_version: patch.to_owned(),
        played_at: manifest.timestamp_ticks.and_then(replay_time),
        players: Vec::new(),
        rounds: Vec::new(),
    };
    let mut timeline = Vec::new();
    let parity = |time| {
        evidence
            .side_switches
            .partition_point(|&switch| switch <= time)
            % 2
    };
    let starting_team = evidence
        .round_starts
        .iter()
        .find_map(|&(time, number)| {
            let attacker = result_attacker(results.get(&number).copied()?)?;
            Some(if parity(time) == 0 {
                attacker
            } else {
                attacker.opposite()
            })
        })
        .context("no round result with a known attacking side")?;

    for (index, &(start, number)) in evidence.round_starts.iter().enumerate() {
        let phase = phases
            .iter()
            .min_by_key(|phase| phase.start.abs_diff(start))
            .filter(|phase| phase.start.abs_diff(start) <= 100)
            .with_context(|| format!("round {number} lacks a matching phase-start RPC"))?;
        let result = results.get(&number).copied();
        let attacker = result.and_then(result_attacker).unwrap_or_else(|| {
            if parity(start) == 0 {
                starting_team
            } else {
                starting_team.opposite()
            }
        });
        let round_id = number.checked_add(1).context("round identifier overflow")?;
        let round = Round {
            round_id,
            start_time_ms: start,
            buy_end_ms: phase.buy_end.map(|stamp| stamp.0),
            end_time_ms: phase.end,
            attacker_team_id: attacker,
            defender_team_id: attacker.opposite(),
            winner_team_id: result.and_then(|r| r.winner),
        };
        let next = evidence
            .round_starts
            .get(index + 1)
            .map_or(u32::MAX, |point| point.0);
        let begin = evidence.events.partition_point(|event| event.time < start);
        let end = evidence.events.partition_point(|event| event.time < next);
        let events = &evidence.events[begin..end];
        let revives_or_deaths = events
            .iter()
            .filter_map(|event| match event.kind {
                RawKind::Kill(_, victim) | RawKind::Revive(victim) => {
                    roster.by_guid.get(&victim).copied()
                }
                _ => None,
            })
            .collect::<HashSet<_>>();
        let baseline = phase.buy_end.unwrap_or((phase.start, usize::MAX));
        let active = roster
            .players
            .iter()
            .enumerate()
            .map(|(index, _)| {
                let updates = evidence
                    .bodies
                    .get(&roster.state_guids[index][0])
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let position = updates.partition_point(|&(stamp, _)| stamp <= baseline);
                let latest = position.checked_sub(1).map(|position| updates[position].1);
                latest != Some(0) || revives_or_deaths.contains(&index)
            })
            .collect::<Vec<_>>();
        let mut state = Rebuilder::new(
            roster
                .players
                .iter()
                .zip(&active)
                .filter_map(|(player, &active)| active.then_some(player)),
            attacker,
        );
        let (attackers_sample, defenders_sample) = loadout_before(&evidence, &teams, &round, phase);
        let initial_state = InitialState {
            state: state.snapshot(start, round.buy_end_ms),
            attackers_loadout_value: attackers_sample.map(|sample| sample.1),
            defenders_loadout_value: defenders_sample.map(|sample| sample.1),
            attackers_loadout_time_ms: attackers_sample.map(|sample| sample.0),
            defenders_loadout_time_ms: defenders_sample.map(|sample| sample.0),
        };
        let mut items = Vec::new();
        let mut life_starts = vec![start; roster.players.len()];
        for event in events {
            let mut fuse = None;
            let kind = match event.kind {
                RawKind::Kill(killer, victim) => {
                    let &victim = roster.by_guid.get(&victim).with_context(|| {
                        format!("unresolved victim {victim} at {} ms", event.time)
                    })?;
                    let damage_by_player = if round.end_time_ms.is_none_or(|end| event.time <= end)
                    {
                        roster.kill_damage(
                            &victim_hits[victim],
                            killer,
                            victim,
                            life_starts[victim],
                            event.time,
                        )
                    } else {
                        BTreeMap::new()
                    };
                    EventKind::Kill {
                        killer_id: roster.id(killer),
                        victim_id: roster.players[victim].player_id.clone(),
                        damage_by_player,
                    }
                }
                RawKind::Revive(victim) => {
                    let &victim = roster.by_guid.get(&victim).with_context(|| {
                        format!("unresolved revive target {victim} at {} ms", event.time)
                    })?;
                    life_starts[victim] = event.time;
                    EventKind::Revive {
                        target_id: roster.players[victim].player_id.clone(),
                    }
                }
                RawKind::Plant => {
                    let explosion = events
                        .iter()
                        .find(|e| e.time >= event.time && matches!(e.kind, RawKind::Explode))
                        .map(|event| event.time);
                    let (site, deadline) = evidence.plant(event.time, explosion);
                    fuse = deadline;
                    EventKind::SpikePlanted { site }
                }
                RawKind::Defuse => EventKind::SpikeDefused,
                RawKind::Explode => EventKind::SpikeExploded,
            };
            let deadline = round_deadline(&evidence.round_clock, &round, event.time);
            items.push(
                state
                    .apply(event.time, kind, deadline, fuse)
                    .with_context(|| format!("round {round_id} at {} ms", event.time))?,
            );
        }
        record_round_stats(
            &mut totals,
            &roster,
            &evidence.stats,
            &round,
            next,
            events,
            &active,
        );
        summary.rounds.push(round);
        timeline.push(RoundTimeline {
            round_id,
            initial_state,
            events: items,
        });
    }
    if let Some(event) = evidence.events.first()
        && event.time < summary.rounds[0].start_time_ms
    {
        bail!(
            "combat or Spike event precedes the first round at {} ms",
            event.time
        );
    }
    let round_count = summary.rounds.len() as f64;
    for ((player, states), total) in roster
        .players
        .iter_mut()
        .zip(&roster.state_guids)
        .zip(totals)
    {
        let score = states
            .iter()
            .filter_map(|state| evidence.stats.scores.get(state))
            .max();
        let damage = evidence
            .stats
            .damage_and_hits(states, player.team_id, &summary.rounds);
        let scoreboard = evidence.stats.scoreboard_totals(states);
        let diff = match scoreboard {
            Some((kills, deaths, _)) => i64::from(kills) - i64::from(deaths),
            None => i64::from(total.kills) - i64::from(total.deaths),
        };
        player.stats = PlayerStats {
            kills: scoreboard.map(|(kills, _, _)| kills),
            deaths: scoreboard.map(|(_, deaths, _)| deaths),
            assists: scoreboard.map(|(_, _, assists)| assists),
            kill_diff: if diff == 0 {
                "0".to_owned()
            } else {
                format!("{diff:+}")
            },
            first_kills: total.first_kills,
            first_deaths: total.first_deaths,
            kast: 100.0 * f64::from(total.kast_rounds) / f64::from(total.played.max(1)),
            acs: (!evidence.stats.scores.is_empty())
                .then(|| f64::from(score.map_or(0, |&(_, score)| score)) / round_count),
            hs_percent: damage
                .map(|(_, headshots, hits)| 100.0 * f64::from(headshots) / f64::from(hits.max(1))),
            adr: damage.map(|(damage, _, _)| damage / round_count),
        };
    }
    summary.players = roster.players;
    Ok((summary, timeline))
}

fn result_attacker(result: &RoundResult) -> Option<Team> {
    let winner = result.winner?;
    Some(if result.winner_attacks? {
        winner
    } else {
        winner.opposite()
    })
}

type LoadoutSample = Option<(u32, i64)>;

fn loadout_before(
    evidence: &Evidence,
    teams: &HashMap<u32, Team>,
    round: &Round,
    phase: &RoundPhase,
) -> (LoadoutSample, LoadoutSample) {
    let Some(boundary) = phase.buy_end else {
        return (None, None);
    };
    let at_barrier = |team: Team| {
        teams
            .iter()
            .filter(|(_, assigned)| **assigned == team)
            .filter_map(|(actor, _)| evidence.loadouts.get(actor))
            .filter_map(|updates| {
                let position = updates.partition_point(|&(stamp, _)| stamp < boundary);
                position.checked_sub(1).map(|position| updates[position])
            })
            .max_by_key(|entry| entry.0)
            .filter(|&((time, _), _)| time >= round.start_time_ms)
            .map(|((time, _), value)| (time, value))
    };
    (
        at_barrier(round.attacker_team_id),
        at_barrier(round.defender_team_id),
    )
}

fn round_deadline(samples: &[(u32, u32)], round: &Round, time: u32) -> Option<u32> {
    let buy_end = round.buy_end_ms?;
    if time < buy_end {
        return Some(buy_end);
    }
    if round.end_time_ms.is_some_and(|end| end < time) {
        return Some(time);
    }
    let position = samples.partition_point(|&(stamp, _)| stamp <= time);
    let (stamp, remaining) = *samples.get(position.checked_sub(1)?)?;
    (stamp >= buy_end).then(|| stamp.saturating_add(remaining))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roster_excludes_observer_without_an_agent_or_character() {
        let manifest = Manifest {
            friendly_name: String::new(),
            replay_build: String::new(),
            timestamp_ticks: None,
            level_names_and_times: Vec::new(),
            game_specific_data: vec![
                r#"{"playerLoadouts":[{"subject":"observer","characterId":""},{"subject":"player","characterId":"agent"}]}"#.into(),
            ],
            players: vec![
                Identity {
                    actor_net_guid: 10,
                    subject: Some("observer".into()),
                    character_net_guids: Vec::new(),
                },
                Identity {
                    actor_net_guid: 20,
                    subject: Some("player".into()),
                    character_net_guids: vec![21],
                },
            ],
            quality: ManifestQuality {
                content_blocks_lost: 0,
                replay_data_trailing_bytes: 0,
                event_layout_mismatches: 0,
            },
        };
        let evidence = Evidence {
            assigned_teams: BTreeMap::from([(10, vec![((0, 0), 1)]), (20, vec![((0, 0), 1)])]),
            ..Evidence::default()
        };
        let teams = HashMap::from([(1, Team::Blue)]);
        let roster = Roster::build(&manifest, &evidence, &teams).unwrap();
        assert_eq!(roster.players.len(), 1);
        assert_eq!(roster.players[0].player_id, "player");
        assert_eq!(roster.by_guid, HashMap::from([(20, 0), (21, 0)]));
        let snapshot = Rebuilder::new(roster.players.iter(), Team::Blue).snapshot(0, None);
        assert_eq!(snapshot.attackers_alive, 1);
    }

    #[test]
    fn replay_timestamp_uses_unreal_epoch() {
        assert_eq!(
            replay_time(639_305_203_780_680_000).as_deref(),
            Some("2026-11-17T13:52:58.068Z")
        );
        assert_eq!(replay_time(0), None);
        assert_eq!(replay_time(i64::MAX), None);
    }

    #[test]
    fn kill_damage_uses_only_same_life_and_stops_at_lethal_hit() {
        let roster = Roster {
            players: [
                ("victim", Team::Blue),
                ("killer", Team::Red),
                ("helper", Team::Red),
            ]
            .into_iter()
            .map(|(id, team_id)| Player {
                player_id: id.into(),
                team_id,
                agent_id: String::new(),
                stats: PlayerStats::default(),
            })
            .collect(),
            by_guid: HashMap::from([(10, 0), (20, 1), (30, 2)]),
            state_guids: vec![],
        };
        let hit = |time, respawn, damager, amount, lethal| DamageHit {
            stamp: (time, 0),
            victim: 10,
            damager,
            kill_credit: if lethal { damager } else { 0 },
            respawn,
            life_change_index: time,
            amount,
            lethal,
        };
        let hits = [
            hit(100, 1, 30, 95.0, false),
            hit(305, 1, 30, 95.0, false),
            hit(400, 2, 30, 90.0, false),
            hit(450, 2, 10, 10.0, false),
            hit(510, 2, 20, 30.0, true),
            hit(520, 2, 30, 20.0, false),
        ];
        let hits = hits.iter().collect::<Vec<_>>();
        assert_eq!(
            roster.kill_damage(&hits, 20, 0, 300, 500),
            BTreeMap::from([("helper".into(), 90.0), ("killer".into(), 30.0)]),
        );
        assert!(roster.kill_damage(&hits, 30, 0, 300, 500).is_empty());
        assert!(roster.kill_damage(&hits, 20, 0, 300, 800).is_empty());
    }

    #[test]
    fn loadout_uses_only_updates_before_the_barrier_in_this_round() {
        let mut evidence = Evidence::default();
        evidence.loadouts.insert(
            1,
            vec![((180, 1), 1_000), ((200, 3), 2_000), ((200, 5), 3_000)],
        );
        evidence
            .loadouts
            .insert(2, vec![((99, 0), 4_000), ((201, 0), 5_000)]);
        let round = Round {
            round_id: 2,
            start_time_ms: 100,
            buy_end_ms: Some(200),
            end_time_ms: None,
            attacker_team_id: Team::Red,
            defender_team_id: Team::Blue,
            winner_team_id: None,
        };
        let phase = RoundPhase {
            start: 100,
            buy_end: Some((200, 4)),
            end: None,
        };
        let teams = HashMap::from([(1, Team::Red), (2, Team::Blue)]);

        assert_eq!(
            loadout_before(&evidence, &teams, &round, &phase),
            (Some((200, 2_000)), None)
        );
    }
}
