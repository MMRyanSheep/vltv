"""VLTV's VALORANT adaptation of the six public HLTV Rating 3.0 components."""

from collections import Counter, defaultdict
from math import fsum

from build_dataset import iter_live_events
from calculate_swing import damage_shares


RATING_VERSION = "1.0"
TRADE_WINDOW_MS = 5_000
DAMAGE_ASSIST = 40
RATING_SPREAD = 0.60

# Each component is centered on the match. The scales put differences in
# comparable units before applying the weights, with kills carrying the most.
COMPONENTS = (
    (0.32, 0.30),  # Economy-adjusted kills per round
    (0.17, 50.0),  # Damage per round
    (0.16, 0.30),  # Negative economy-adjusted deaths per round
    (0.12, 0.25),  # Fraction of rounds with a KAST contribution
    (0.09, 0.40),  # Economy-adjusted kills beyond the first in each round
    (0.14, 10.0),  # Swing in percentage points per round
)


def economy_weights(initial, result):
    attackers = initial["attackers_loadout_value"]
    defenders = initial["defenders_loadout_value"]
    adjustment = 0.0
    if attackers is not None and defenders is not None and attackers + defenders > 0:
        adjustment = 0.25 * ((defenders - attackers) / (attackers + defenders))
    return {
        result["attacker_team_id"]: 1 + adjustment,
        result["defender_team_id"]: 1 - adjustment,
    }


def rating_components(players, rounds, evaluated_kills):
    teams = {player["player_id"]: player["team_id"] for player in players}
    kills, deaths, kast, multi, swing = (Counter() for _ in range(5))
    completed = 0
    for row in rounds:
        result, timeline = row["result"], row["timeline"]
        if result["winner_team_id"] is None:
            continue
        completed += 1
        weights = economy_weights(timeline["initial_state"], result)
        round_kills = Counter()
        alive = set(teams)
        contributed = set()
        trade_targets = defaultdict(list)
        for event in iter_live_events(timeline, result):
            if event["type"] == "revive":
                alive.add(event["target_id"])
            if event["type"] != "kill":
                continue
            killer, victim = event["killer_id"], event["victim_id"]
            victim_team = teams[victim]
            alive.discard(victim)
            deaths[victim] += 2 - weights[victim_team]
            earlier_kills = trade_targets.pop(victim, ())
            if killer is None or teams[killer] == victim_team:
                continue
            round_kills[killer] += 1
            contributed.add(killer)
            time = event["time_ms"]
            contributed.update(
                teammate for teammate, death_time in earlier_kills if time - death_time <= TRADE_WINDOW_MS
            )
            trade_targets[killer].append((victim, time))

        for event, attacker_swing, damage in evaluated_kills.get(result["round_id"], ()):
            killer, victim = event["killer_id"], event["victim_id"]
            if killer is None or teams[killer] == teams[victim]:
                continue
            contributed.update(player for player, amount in damage.items() if amount >= DAMAGE_ASSIST)
            kill_swing = attacker_swing if teams[killer] == result["attacker_team_id"] else -attacker_swing
            # A model prediction can move in the wrong direction on an enemy kill.
            kill_swing = max(0.0, kill_swing)
            for player, share in damage_shares(killer, damage).items():
                swing[player] += kill_swing * share
            swing[victim] -= kill_swing

        for player, count in round_kills.items():
            weight = weights[teams[player]]
            kills[player] += weight * count
            multi[player] += weight * (count - 1)
        kast.update(alive | contributed)

    if not completed:
        return {}

    # Scoreboard averages cover the report as a whole. Use the event-based
    # KAST and leave ADR unavailable when some of that report is unfinished.
    complete_report = completed == len(rounds)
    rows = {}
    for player in players:
        player_id = player["player_id"]
        reported_kast = player.get("kast") if complete_report else None
        rows[player_id] = (
            kills[player_id] / completed,
            player.get("adr") if complete_report else None,
            -deaths[player_id] / completed,
            reported_kast / 100 if reported_kast is not None else kast[player_id] / completed,
            multi[player_id] / completed,
            swing[player_id] / completed,
        )
    return rows


def calculate_ratings(players, rounds, evaluated_kills):
    rows = rating_components(players, rounds, evaluated_kills)
    if not rows:
        return {}

    baselines = []
    for column in zip(*rows.values(), strict=True):
        known = [value for value in column if value is not None]
        baselines.append(fsum(value / len(known) for value in known))
    return {
        player: max(0.0, 1 + RATING_SPREAD * fsum(
            (value - baseline) / scale * weight
            for value, baseline, (weight, scale) in zip(row, baselines, COMPONENTS, strict=True)
            if value is not None
        ))
        for player, row in rows.items()
    }
