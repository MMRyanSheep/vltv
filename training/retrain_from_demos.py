"""Export Windows VALORANT demos, retrain the round-win model, and publish it."""

import argparse
import csv
import hashlib
import json
import math
import msvcrt
import os
import shutil
import subprocess
import sys
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from build_dataset import FIELDS, TRAINING_DIR, iter_match_rows, iter_matches


PROJECT = TRAINING_DIR.parent
DEMO_DIRECTORY = Path(
    r"C:\Program Files (x86)\Tencent Games\VALORANT\live\ShooterGame\Saved\Demos"
)
DATASET = TRAINING_DIR / "dataset.csv"
MODEL = TRAINING_DIR / "round_win_model.txt"
BUILDS = TRAINING_DIR / "builds"
MATCH_ID_COLUMN = FIELDS.index("match_id")
SCORE_FIELDS = ("match_id", "map_id", "player_id", "team_id", "agent_id", "swingscore", "ssversion")


def find_tools(args):
    exporter = args.exporter or PROJECT / "target/release/vltv.exe"
    if args.exporter is None and not exporter.is_file():
        subprocess.run(["cargo", "build", "--locked", "--release"], cwd=PROJECT, check=True)
    if not exporter.is_file():
        raise FileNotFoundError(exporter)

    vrfkit = args.vrfkit or PROJECT / "target/vrfkit-build/release/vrfkit.exe"
    if args.vrfkit is None and not vrfkit.is_file():
        subprocess.run(
            ["powershell", "-NoProfile", "-File", PROJECT / "scripts/build-vrfkit.ps1"],
            cwd=PROJECT,
            check=True,
        )
    if not vrfkit.is_file():
        raise FileNotFoundError(vrfkit)
    return exporter, vrfkit


def export_demos(replays, scratch, exporter, vrfkit):
    fresh_rows = {}
    failures = []
    reports = []
    for index, replay in enumerate(replays, start=1):
        print(f"[{index}/{len(replays)}] {replay}", flush=True)
        report = scratch / str(index)
        try:
            subprocess.run([exporter, "export", replay, report, vrfkit], check=True)
            match, timelines = next(iter_matches(report))
            timelines = list(timelines)
            match_id = match["match_id"]
            rows = list(iter_match_rows(match, timelines))
            if not rows:
                raise ValueError("no labeled round snapshots")
            if match_id in fresh_rows:
                if fresh_rows[match_id] != rows:
                    raise ValueError(f"conflicting replay data for match {match_id}")
                print(f"Duplicate match {match_id}", flush=True)
                continue
            fresh_rows[match_id] = rows
            reports.append({"summary": match, "timeline": {"match_id": match_id, "rounds": timelines}})
        except (OSError, subprocess.CalledProcessError, KeyError, TypeError, ValueError) as error:
            print(f"Export failed for {replay}: {error}", file=sys.stderr, flush=True)
            failures.append(replay)

    if failures:
        raise ValueError(f"{len(failures)} of {len(replays)} replay exports failed")
    return fresh_rows, reports


def write_training_data(output, fresh_rows, include_previous):
    retained = set()
    count = sum(map(len, fresh_rows.values()))
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(FIELDS)
        if include_previous and DATASET.is_file():
            with DATASET.open(encoding="utf-8", newline="") as previous:
                reader = csv.reader(previous)
                if next(reader, None) != list(FIELDS):
                    raise ValueError(f"Unexpected CSV header in {DATASET}")
                for row in reader:
                    if len(row) != len(FIELDS):
                        raise ValueError(f"Invalid CSV row {reader.line_num} in {DATASET}")
                    match_id = row[MATCH_ID_COLUMN]
                    if match_id not in fresh_rows:
                        writer.writerow(row)
                        retained.add(match_id)
                        count += 1
        for rows in fresh_rows.values():
            writer.writerows(rows)
    print(f"Dataset: {count} snapshots, {len(fresh_rows)} replay matches, "
          f"{len(retained)} retained matches", flush=True)


def verify_calculator(model, reports, versions, output):
    scores = []
    for report in reports:
        match_id = report["summary"]["match_id"]
        process = subprocess.run(
            [sys.executable, "-X", "utf8", PROJECT / "server/calculate_report.py", model],
            input=json.dumps(report), encoding="utf-8", stdout=subprocess.PIPE,
            env={**os.environ, "OMP_NUM_THREADS": "1"},
        )
        if process.returncode != 0:
            raise ValueError(f"Web calculator exited with code {process.returncode} for {match_id}")
        calculated = json.loads(process.stdout)
        players = calculated["players"]
        if (
            calculated["match_id"] != match_id or calculated["ssversion"] not in versions
            or len(players) != len(report["summary"]["players"])
            or not all(math.isfinite(player["swingscore"]) for player in players)
        ):
            raise ValueError(f"Web calculator failed to produce valid SwingScores for {match_id}")
        scores.extend({**player, "ssversion": calculated["ssversion"]} for player in players)

    scores.sort(key=lambda player: (player["match_id"], -player["swingscore"], player["player_id"]))
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SCORE_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(scores)
    print(f"Verified {len(scores)} SwingScores across {len(reports)} matches in {output}")


def publish(build, web_model):
    destinations = {DATASET: build / DATASET.name, MODEL: build / MODEL.name}
    if web_model is not None:
        if web_model == DATASET:
            raise ValueError("The web model path conflicts with the training CSV")
        destinations[web_model] = build / MODEL.name

    previous = build / "previous"
    previous.mkdir()
    with ExitStack() as stack:
        staged = []
        for index, (destination, source) in enumerate(destinations.items(), start=1):
            # Stage on the destination volume so each model replacement is atomic.
            scratch = Path(stack.enter_context(TemporaryDirectory(dir=destination.parent)))
            replacement = scratch / "new"
            shutil.copyfile(source, replacement)
            original = None
            if destination.exists():
                original = scratch / "previous"
                shutil.copyfile(destination, original)
                shutil.copyfile(original, previous / f"{index}-{destination.name}")
            staged.append((destination, replacement, original))

        installed = []
        try:
            for destination, replacement, original in staged:
                replacement.replace(destination)
                installed.append((destination, original))
        except (OSError, KeyboardInterrupt):
            for destination, original in reversed(installed):
                if original is None:
                    destination.unlink()
                else:
                    original.replace(destination)
            raise
    for destination in destinations:
        print(f"Published {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo-dir", type=Path, default=DEMO_DIRECTORY)
    parser.add_argument("--exporter", type=Path, help="existing vltv executable")
    parser.add_argument("--vrfkit", type=Path, default=os.environ.get("VRFKIT"))
    parser.add_argument("--web-model", type=Path, default=os.environ.get("VLTV_SWING_MODEL"),
                        help="additional model file used by the API, if configured")
    parser.add_argument("--replays-only", action="store_true",
                        help="train exclusively on the replays in --demo-dir")
    args = parser.parse_args()

    sys.path.insert(1, str(TRAINING_DIR / ".deps"))
    try:
        import lightgbm as lgb
        from calculate_swing import LEGACY_SWINGSCORE_VERSION, SWINGSCORE_VERSION
        from training import train
    except ImportError as error:
        parser.exit(1, f"Install dependencies with python -m pip install -r server/requirements.txt\n{error}\n")

    try:
        source = args.demo_dir.resolve(strict=True)
        if not source.is_dir():
            raise NotADirectoryError(source)
        replays = sorted(path for path in source.rglob("*.vrf") if path.is_file())
        if not replays:
            raise ValueError(f"No .vrf files found in {source}")
        web_model = args.web_model.resolve() if args.web_model else None

        BUILDS.mkdir(exist_ok=True)
        with (BUILDS / ".lock").open("a+b") as lock:
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise RuntimeError("Could not acquire the model build lock") from error

            exporter, vrfkit = find_tools(args)
            with TemporaryDirectory(dir=BUILDS) as temporary:
                fresh_rows, reports = export_demos(replays, Path(temporary), exporter, vrfkit)

            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            build = BUILDS / f"v{SWINGSCORE_VERSION}-{stamp}"
            build.mkdir()
            dataset = build / DATASET.name
            candidate = build / MODEL.name
            write_training_data(dataset, fresh_rows, include_previous=not args.replays_only)
            train(dataset, candidate, validation_fraction=0.25, seed=42, rounds=120, refit=True)
            verify_calculator(
                candidate, reports, {LEGACY_SWINGSCORE_VERSION, SWINGSCORE_VERSION},
                build / "swing_scores.csv",
            )
            publish(build, web_model)
            fingerprint = hashlib.sha256(candidate.read_bytes()).hexdigest()
            print(f"SwingScore v{SWINGSCORE_VERSION} build {build.name} (SHA-256 {fingerprint})")
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.CalledProcessError,
            lgb.basic.LightGBMError) as error:
        parser.exit(1, f"Could not complete the model build: {error}\n")


if __name__ == "__main__":
    main()
