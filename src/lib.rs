//! Export round metadata and event states from VALORANT bomb-mode replays.

use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::Path,
    process::Command,
};

use anyhow::{Context, Result, ensure};
use model::{Event, EventKind, InitialState, Match, RoundTimeline};
use serde::Serialize;

mod damage;
pub mod model;
mod replay;
mod state;
mod stats;
mod tables;

#[derive(Debug)]
pub struct ReplayExport {
    pub summary: Match,
    pub timelines: Vec<RoundTimeline>,
}

#[derive(Serialize)]
struct TimelineDocument<'a> {
    match_id: &'a str,
    round_id: u32,
    initial_state: &'a InitialState,
    events: &'a [Event],
}

/// Decode a replay using the selected vrfkit executable and reconstruct the
/// JSON documents in memory.
pub fn read_replay(vrfkit: &Path, replay: &Path) -> Result<ReplayExport> {
    let scratch = tempfile::tempdir().context("creating temporary vrfkit workspace")?;
    let tables = scratch.path().join("tables");
    let result = Command::new(vrfkit)
        .arg("export")
        .arg(replay)
        .arg("--out")
        .arg(&tables)
        .output()
        .with_context(|| format!("starting {}", vrfkit.display()))?;
    ensure!(
        result.status.success(),
        "vrfkit export failed for {} ({})\n{}\n{}",
        replay.display(),
        result.status,
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    read_vrfkit_export(&tables, None)
}

/// Reconstruct JSON from a directory of already decoded vrfkit tables.
/// If omitted, the match ID comes from the replay's friendly name.
pub fn read_vrfkit_export(directory: &Path, match_id: Option<&str>) -> Result<ReplayExport> {
    let (summary, timelines) = replay::reconstruct(directory, match_id)?;
    Ok(ReplayExport { summary, timelines })
}

impl ReplayExport {
    /// Write Json1, one full Json2 timeline per round, and one Json2 prefix
    /// per kill. Publish the output directory after every file is written.
    pub fn write(&self, output: &Path) -> Result<usize> {
        ensure!(
            output.file_name().is_some(),
            "output must name a new directory"
        );
        ensure!(
            !output.try_exists()?,
            "output directory already exists: {}",
            output.display()
        );
        let parent = output
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let staging = tempfile::tempdir_in(parent)?;
        let kills_dir = staging.path().join("json2");
        let rounds_dir = staging.path().join("rounds");
        fs::create_dir(&kills_dir)?;
        fs::create_dir(&rounds_dir)?;
        write_json(&staging.path().join("json1.json"), &self.summary)?;

        let mut kills = 0;
        for round in &self.timelines {
            let document = |events| TimelineDocument {
                match_id: &self.summary.match_id,
                round_id: round.round_id,
                initial_state: &round.initial_state,
                events,
            };
            write_json(
                &rounds_dir.join(format!("{:03}.json", round.round_id)),
                &document(&round.events),
            )?;
            for (index, event) in round.events.iter().enumerate() {
                if matches!(event.kind, EventKind::Kill { .. }) {
                    kills += 1;
                    let path = kills_dir.join(format!("{kills:06}.json"));
                    write_json(&path, &document(&round.events[..=index]))?;
                }
            }
        }
        fs::rename(staging.path(), output)
            .with_context(|| format!("publishing {}", output.display()))?;
        Ok(kills)
    }
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut writer = BufWriter::new(File::create(path)?);
    serde_json::to_writer_pretty(&mut writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}
