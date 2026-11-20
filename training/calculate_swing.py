"""Calculate each player's round-win probability swing per round from replay kills.

Score is the sum of attributed percentage points divided by all match rounds,
including rounds with no contribution. For a positive enemy kill swing with
damage evidence, half goes to the killer and half is split by damage dealt
to the victim during that life. The victim receives the opposite change.
Without damage evidence, the killer receives the full team-side change.
Team kills are attributed to the killer alone. Self-kills and deaths with no
credited killer are attributed to the victim. Spike and revive events affect
the state but have no actor attribution.
"""

import argparse
import math
from pathlib import Path
from tempfile import TemporaryDirectory

import lightgbm as lgb
import pandas as pd

from build_dataset import SPIKE_FUSE_MS, iter_matches, snapshot_features
from training import FEATURES, TRAINING_DIR, prepare_features


LEGACY_SWINGSCORE_VERSION = "1.1"
SWINGSCORE_VERSION = "1.2"
DAMAGE_SHARE = 0.5


def iter_live_events(timeline, result):
    round_end = result["end_time_ms"]
    for event in timeline["events"]:
        if event["type"] in ("spike_defused", "spike_exploded") or (
            round_end is not None and event["time_ms"] > round_end
        ):
            break
        yield event


def iter_round_kills(match, timeline, result):
    round_number = timeline["round_id"]
    initial = timeline["initial_state"]
    plant_time = None
    plant_site = None

    for event in iter_live_events(timeline, result):
        time = event["time_ms"]
        event_type = event["type"]
        if event_type == "spike_planted":
            plant_time = time
            plant_site = event["site"]
        if event_type != "kill":
            continue

        # Both snapshots share the live clock used by the training dataset.
        fuse = None if plant_time is None else max(0, SPIKE_FUSE_MS - (time - plant_time))
        before_state = event["before"]
        after_state = event["after"]
        snapshots = (
            snapshot_features(match, round_number, initial, state, plant_site, fuse)
            for state in (before_state, after_state)
        )
        # Wiping the attackers only ends the round before a Spike plant.
        terminal_probability = None
        if after_state["defenders_alive"] == 0:
            terminal_probability = 1.0
        elif after_state["attackers_alive"] == 0 and plant_time is None:
            terminal_probability = 0.0
        yield event, tuple(snapshots), terminal_probability
        if terminal_probability is not None:
            break


def kill_damage(event, teams):
    damage = event.get("damage_by_player", {})
    killer = event["killer_id"]
    killer_team = teams.get(killer)
    if not isinstance(damage, dict):
        raise ValueError("Invalid damage_by_player")
    if damage and (
        killer_team is None or killer_team == teams[event["victim_id"]] or killer not in damage
        or any(
            teams.get(player) != killer_team or type(amount) not in (int, float)
            or not math.isfinite(amount) or amount <= 0
            for player, amount in damage.items()
        )
    ):
        raise ValueError("Invalid damage_by_player for kill")
    return damage


def evaluate_kills(model, match, timelines):
    """Return the attacking side's win probability change for each live kill."""
    match_id = match["match_id"]
    teams = {player["player_id"]: player["team_id"] for player in match["players"]}
    round_results = {result["round_id"]: result for result in match["rounds"]}
    snapshots = []
    kills = []
    for timeline in timelines:
        round_id = timeline["round_id"]
        if timeline.get("match_id", match_id) != match_id:
            raise ValueError(f"Unexpected match ID in round {round_id}")
        result = round_results.pop(round_id, None)
        if result is None:
            raise ValueError(f"Missing result or duplicate timeline for {match_id}, round {round_id}")
        for event, pair, terminal in iter_round_kills(match, timeline, result):
            snapshots.extend(pair)
            kills.append((round_id, event, terminal, kill_damage(event, teams)))
    if round_results:
        raise ValueError(f"Missing round timelines for {match_id}: {sorted(round_results)}")

    by_round = {}
    if not snapshots:
        return by_round
    features = prepare_features(pd.DataFrame(snapshots, columns=FEATURES))
    probabilities = model.predict(features, validate_features=True).reshape(-1, 2)
    for (round_id, event, terminal, damage), (before, after) in zip(kills, probabilities, strict=True):
        if terminal is not None:
            after = terminal
        swing = float(after - before) * 100
        by_round.setdefault(round_id, []).append((event, swing, damage))
    return by_round


def damage_shares(killer, damage):
    if len(damage) <= 1:
        return {killer: 1.0}
    total = math.fsum(damage.values())
    shares = {player: DAMAGE_SHARE * (amount / total) for player, amount in damage.items()}
    shares[killer] += 1 - DAMAGE_SHARE
    return shares


def calculate_swingscores(match, evaluated_kills):
    match_id = match["match_id"]
    teams = {player["player_id"]: player["team_id"] for player in match["players"]}
    scores = dict.fromkeys(teams, 0.0)
    round_count = len(match["rounds"])
    attackers_by_round = {result["round_id"]: result["attacker_team_id"] for result in match["rounds"]}
    version = LEGACY_SWINGSCORE_VERSION
    for round_id, kills in evaluated_kills.items():
        attackers = attackers_by_round[round_id]
        for event, swing, damage in kills:
            if damage:
                version = SWINGSCORE_VERSION

            killer = event["killer_id"]
            victim = event["victim_id"]
            killer_team = teams.get(killer)
            victim_team = teams[victim]
            if killer_team is not None and killer != victim:
                killer_swing = swing if killer_team == attackers else -swing
                shares = damage_shares(killer, damage) if killer_swing > 0 else {killer: 1.0}
                for player, share in shares.items():
                    scores[player] += killer_swing * share
            if killer_team != victim_team or killer == victim:
                scores[victim] += swing if victim_team == attackers else -swing

    return [
        {
            "match_id": match_id,
            "map_id": match["map_id"],
            **{key: value for key, value in player.items() if key != "ssversion"},
            "swingscore": scores[player["player_id"]] / round_count if round_count else 0.0,
            "ssversion": version,
        }
        for player in match["players"]
    ]


def calculate_match(model, match, timelines):
    return calculate_swingscores(match, evaluate_kills(model, match, timelines))


def calculate_swing(source, model_path, output):
    model = lgb.Booster(model_file=model_path)
    scores = []
    for match, timelines in iter_matches(source):
        scores.extend(calculate_match(model, match, timelines))
    if not scores:
        raise ValueError(f"No players found in replay exports in {source}")
    rows = pd.DataFrame(scores).sort_values(
        ["match_id", "swingscore", "player_id"], ascending=[True, False, True]
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as temporary:
        temporary_output = Path(temporary) / output.name
        rows.to_csv(temporary_output, index=False, float_format="%.6f")
        temporary_output.replace(output)
    return rows["match_id"].nunique(), len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--input", type=Path, default=TRAINING_DIR.parent / "exampleReport",
        help="report directory with matches/ and events/, or a VLTV export directory",
    )
    parser.add_argument(
        "--model", type=Path, default=TRAINING_DIR / "round_win_model.txt",
        help="trained LightGBM round win model",
    )
    parser.add_argument(
        "--output", type=Path, default=TRAINING_DIR / "swing_scores.csv",
        help="destination CSV (default: training/swing_scores.csv)",
    )
    args = parser.parse_args()
    if args.output.suffix.lower() != ".csv":
        parser.error("--output must have a .csv extension")
    if args.model.resolve() == args.output.resolve():
        parser.error("--output must be different from --model")
    try:
        matches, players = calculate_swing(args.input, args.model, args.output)
    except (KeyError, OSError, OverflowError, TypeError, ValueError, lgb.basic.LightGBMError) as error:
        parser.exit(1, f"Could not calculate SwingScore: {error}\n")
    print(
        f"SwingScore (percentage points per round): "
        f"{players} player entries across {matches} matches in {args.output}"
    )


if __name__ == "__main__":
    main()
