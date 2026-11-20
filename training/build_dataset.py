"""Export labeled, live round snapshots from VLTV replay JSON to CSV.

The timers are in seconds and the active clock switches to the Spike clock at
planting. Missing source values are empty cells.
"""

import argparse
import csv
import json
from pathlib import Path
from tempfile import NamedTemporaryFile


FIELDS = (
    "attackers_alive",
    "defenders_alive",
    "round_time_remaining",
    "spike_planted",
    "spike_time_remaining",
    "attackers_loadout_value",
    "defenders_loadout_value",
    "map_id",
    "plant_site",
    "round_number",
    "match_id",
    "attacker_won",
)

TRAINING_DIR = Path(__file__).resolve().parent
SPIKE_FUSE_MS = 45_000


def read_json(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def iter_matches(source):
    summary = source / "json1.json"
    if summary.is_file():
        # Read full rounds. The per-kill JSON files repeat event prefixes.
        round_paths = sorted((source / "rounds").glob("*.json"))
        if not round_paths:
            raise ValueError(f"No round timelines in {source / 'rounds'}")
        yield read_json(summary), (read_json(path) for path in round_paths)
        return

    match_dir = source / "matches"
    event_dir = source / "events"
    match_files = {path.name for path in match_dir.glob("*.json")}
    event_files = {path.name for path in event_dir.glob("*.json")}
    if not match_files and not event_files:
        raise ValueError(f"No replay exports found in {source}")
    unmatched = match_files ^ event_files
    if unmatched:
        raise ValueError(f"Missing match or event JSON for: {', '.join(sorted(unmatched))}")

    for name in sorted(match_files):
        summary = read_json(match_dir / name)
        timeline = read_json(event_dir / name)
        if summary["match_id"] != timeline["match_id"]:
            raise ValueError(f"Match IDs disagree for {name}")
        yield summary, timeline["rounds"]


def seconds(milliseconds):
    return None if milliseconds is None else milliseconds / 1000


def snapshot_features(match, round_number, initial, state, plant_site, spike_remaining_ms):
    planted = spike_remaining_ms is not None
    remaining_ms = spike_remaining_ms if planted else state["remaining_time_ms"]
    return (
        state["attackers_alive"],
        state["defenders_alive"],
        seconds(remaining_ms),
        planted,
        seconds(spike_remaining_ms),
        initial["attackers_loadout_value"],
        initial["defenders_loadout_value"],
        match["map_id"],
        plant_site,
        round_number,
    )


def iter_live_events(timeline, result):
    round_end = result["end_time_ms"]
    for event in timeline["events"]:
        if event["type"] in ("spike_defused", "spike_exploded") or (
            round_end is not None and event["time_ms"] > round_end
        ):
            break
        yield event


def iter_live_states(timeline, result):
    """Yield live events with the Spike clock and any forced outcome after a kill."""
    plant_time = None
    plant_site = None
    for event in iter_live_events(timeline, result):
        time = event["time_ms"]
        if event["type"] == "spike_planted":
            plant_time = time
            plant_site = event["site"]
        # Replay clocks can incorporate the eventual explosion time.
        fuse = None if plant_time is None else max(0, SPIKE_FUSE_MS - (time - plant_time))
        terminal = None
        if event["type"] == "kill":
            after = event["after"]
            if after["defenders_alive"] == 0:
                terminal = 1.0
            elif after["attackers_alive"] == 0 and plant_time is None:
                terminal = 0.0
        yield event, plant_site, fuse, terminal
        if terminal is not None:
            break


def iter_round_rows(match, timeline, result):
    winner = result["winner_team_id"]
    if winner is None:
        return
    if winner not in (result["attacker_team_id"], result["defender_team_id"]):
        raise ValueError(f"Invalid winner for {match['match_id']}, round {result['round_id']}")

    attacker_won = int(winner == result["attacker_team_id"])
    initial = timeline["initial_state"]
    round_number = timeline["round_id"]

    def row(state, plant_site=None, spike_remaining_ms=None):
        return (
            *snapshot_features(
                match, round_number, initial, state, plant_site, spike_remaining_ms
            ),
            match["match_id"],
            attacker_won,
        )

    yield row(initial)
    for event, plant_site, fuse, terminal in iter_live_states(timeline, result):
        # The model learns live states. Scoring handles a forced outcome directly.
        if terminal is not None:
            break
        yield row(event["after"], plant_site, fuse)


def iter_match_rows(match, timelines):
    results = {result["round_id"]: result for result in match["rounds"]}
    for timeline in timelines:
        round_id = timeline["round_id"]
        if match["match_id"] != timeline.get("match_id", match["match_id"]):
            raise ValueError(f"Unexpected match ID in round {round_id}")
        if round_id not in results:
            raise ValueError(f"No round result for {match['match_id']}, round {round_id}")
        yield from iter_round_rows(match, timeline, results[round_id])


def build_dataset(source, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    row_count = 0
    temporary_path = None
    try:
        with NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=output.parent, delete=False
        ) as handle:
            temporary_path = Path(handle.name)
            writer = csv.writer(handle)
            writer.writerow(FIELDS)
            for match, rounds in iter_matches(source):
                for row in iter_match_rows(match, rounds):
                    writer.writerow(row)
                    row_count += 1
            if not row_count:
                raise ValueError(f"No round snapshots found in {source}")
        temporary_path.replace(output)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    return row_count


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input", type=Path, default=TRAINING_DIR.parent / "exampleReport",
        help="report directory with matches/ and events/, or a VLTV export directory",
    )
    parser.add_argument(
        "--output", type=Path, default=TRAINING_DIR / "dataset.csv",
        help="destination CSV file (default: training/dataset.csv)",
    )
    args = parser.parse_args()
    if args.output.suffix.lower() != ".csv":
        parser.error("--output must have a .csv extension")
    try:
        row_count = build_dataset(args.input, args.output)
    except (KeyError, OSError, TypeError, ValueError) as error:
        parser.exit(1, f"Could not build dataset: {error}\n")
    print(f"Exported {row_count} snapshots to {args.output}")


if __name__ == "__main__":
    main()
