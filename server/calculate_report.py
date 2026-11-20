"""Turn one replay report into persisted match statistics using the existing calculator."""

import json
import math
import sys
from collections import Counter
from pathlib import Path
from uuid import UUID

TRAINING_DIR = Path(__file__).resolve().parents[1] / "training"
sys.path[:0] = [str(TRAINING_DIR), str(TRAINING_DIR / ".deps")]

import lightgbm as lgb
from calculate_rating import RATING_VERSION, calculate_ratings
from calculate_swing import calculate_swingscores, evaluate_kills


TEAMS = {"Blue", "Red"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_uuid(value):
    require(isinstance(value, str) and str(UUID(value)) == value, "ID must be a canonical UUID")


def entries(value, label):
    require(isinstance(value, list) and all(isinstance(row, dict) for row in value), f"Invalid {label}")
    return value


def check_state(state):
    for key in ("attackers_alive", "defenders_alive"):
        value = state[key]
        require(type(value) is int and 0 <= value <= 5, f"Invalid {key}")
    time = state["remaining_time_ms"]
    require(time is None or type(time) is int and time >= 0, "Invalid round clock")


def optional_count(player, key):
    value = player.get(key)
    require(value is None or type(value) is int and 0 <= value < 2**31, f"Invalid {key}")
    return value


def optional_stat(player, key, maximum=None):
    value = player.get(key)
    if value is not None:
        require(type(value) in (int, float) and math.isfinite(value) and value >= 0, f"Invalid {key}")
        require(maximum is None or value <= maximum, f"Invalid {key}")
    return value


def calculate(report, model):
    summary = report["summary"]
    timeline = report["timeline"]
    check_uuid(summary["match_id"])
    require(summary["match_id"] == timeline["match_id"], "Match IDs do not match")
    for key in ("map_id", "patch_version"):
        value = summary[key]
        require(isinstance(value, str) and 0 < len(value.strip()) <= 64, f"Invalid {key}")

    players = {}
    for player in entries(summary["players"], "players"):
        player_id = player["player_id"]
        check_uuid(player_id)
        check_uuid(player["agent_id"])
        require(player_id not in players and player["team_id"] in TEAMS, "Invalid player or team")
        players[player_id] = player
    require(
        Counter(p["team_id"] for p in players.values()) == {"Blue": 5, "Red": 5},
        "Expected five distinct players per team",
    )

    rounds = {}
    for result in entries(summary["rounds"], "round results"):
        number = result["round_id"]
        require(type(number) is int and 1 <= number <= 200, "Invalid round number")
        require(number not in rounds, f"Duplicate round {number}")
        require({result["attacker_team_id"], result["defender_team_id"]} == TEAMS, "Invalid round sides")
        require(result["winner_team_id"] is None or result["winner_team_id"] in TEAMS, "Invalid winner")
        start = result["start_time_ms"]
        end = result["end_time_ms"]
        require(type(start) is int and 0 <= start <= 2**32 - 1, "Invalid round start time")
        require(end is None or type(end) is int and start <= end <= 2**32 - 1, "Invalid round end time")
        rounds[number] = result
    require(rounds and sorted(rounds) == list(range(1, len(rounds) + 1)), "Non-consecutive rounds")

    kills = Counter()
    deaths = Counter()
    first_kills = Counter()
    saved_rounds = {}
    timelines = entries(timeline["rounds"], "round timelines")
    for row in timelines:
        number = row["round_id"]
        require(type(number) is int and number in rounds and number not in saved_rounds, "Invalid round timeline")
        result = rounds[number]
        previous_time = result["start_time_ms"]
        opening = True
        initial = row["initial_state"]
        check_state(initial)
        for key in ("attackers_loadout_value", "defenders_loadout_value"):
            value = initial[key]
            require(value is None or type(value) is int and value >= 0, f"Invalid {key}")
        for event in entries(row["events"], "round events"):
            time = event["time_ms"]
            require(type(time) is int and previous_time <= time <= 2**32 - 1, "Events are out of order")
            previous_time = time
            check_state(event["before"])
            check_state(event["after"])
            kind = event["type"]
            if kind == "kill":
                killer = event["killer_id"]
                victim = event["victim_id"]
                require(victim in players and (killer is None or killer in players), "Unknown kill participant")
                if result["end_time_ms"] is not None and time > result["end_time_ms"]:
                    continue
                deaths[victim] += 1
                if killer is not None and players[killer]["team_id"] != players[victim]["team_id"]:
                    kills[killer] += 1
                    if opening:
                        first_kills[killer] += 1
                        opening = False
            elif kind == "revive":
                require(event["target_id"] in players, "Unknown revive target")
            elif kind == "spike_planted":
                site = event["site"]
                require(site is None or isinstance(site, str) and len(site) <= 16, "Invalid Spike site")
            else:
                require(kind in {"spike_defused", "spike_exploded"}, "Unknown event type")
        saved_rounds[number] = {"result": result, "timeline": row}

    evaluated_kills = evaluate_kills(model, summary, timelines)
    scores = calculate_swingscores(summary, evaluated_kills)
    for score in scores:
        player_id = score["player_id"]
        require(math.isfinite(score["swingscore"]), "Non-finite SwingScore")
        player = players[player_id]
        uploaded_fk = optional_count(player, "first_kills")
        scoreboard_kills = optional_count(player, "kills")
        scoreboard_deaths = optional_count(player, "deaths")
        require(
            (scoreboard_kills is None) == (scoreboard_deaths is None),
            "Scoreboard kills and deaths must be supplied together",
        )
        has_scoreboard_kd = scoreboard_kills is not None
        kills_total = scoreboard_kills if has_scoreboard_kd else kills[player_id]
        deaths_total = scoreboard_deaths if has_scoreboard_kd else deaths[player_id]
        diff = kills_total - deaths_total
        score.update(
            kills=kills_total,
            deaths=deaths_total,
            assists=optional_count(player, "assists"),
            has_scoreboard_kd=has_scoreboard_kd,
            kill_diff=f"{diff:+d}" if diff else "0",
            acs=optional_stat(player, "acs"),
            hs_percent=optional_stat(player, "hs_percent", 100),
            first_kills=first_kills[player_id] if uploaded_fk is None else uploaded_fk,
            uploaded_first_kills=uploaded_fk,
            first_deaths=optional_count(player, "first_deaths"),
            kast=optional_stat(player, "kast", 100),
            adr=optional_stat(player, "adr"),
        )

    ratings = calculate_ratings(scores, saved_rounds.values(), evaluated_kills)
    for score in scores:
        rating = ratings.get(score["player_id"])
        require(rating is None or math.isfinite(rating), "Non-finite Rating")
        score["rating"] = rating

    return {
        "match_id": summary["match_id"],
        "map_id": summary["map_id"],
        "patch_version": summary["patch_version"],
        "ssversion": scores[0]["ssversion"],
        "rating_version": RATING_VERSION if ratings else None,
        "players": scores,
        "rounds": list(saved_rounds.values()),
    }


def main():
    model = lgb.Booster(model_file=sys.argv[1])
    try:
        report = json.load(sys.stdin)
        result = calculate(report, model)
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
