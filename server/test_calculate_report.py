import unittest

from calculate_report import calculate_ratings
from build_dataset import iter_round_rows
from calculate_rating import rating_components
from calculate_swing import calculate_match
import numpy as np


class Model:
    def __init__(self, before, after):
        self.probabilities = np.array([before, after])

    def predict(self, features, *, validate_features):
        return self.probabilities


class SwingScoreTests(unittest.TestCase):
    def round_fixture(self, **damage):
        result = {"round_id": 1, "attacker_team_id": "Red", "defender_team_id": "Blue",
                  "winner_team_id": "Red", "end_time_ms": 1000}
        match = {
            "match_id": "match",
            "map_id": "Lotus",
            "rounds": [result],
            "players": [
                {"player_id": player, "team_id": team}
                for player, team in (("killer", "Red"), ("helper", "Red"), ("victim", "Blue"))
            ],
        }
        state = {"attackers_alive": 2, "defenders_alive": 2, "remaining_time_ms": 1000}
        timeline = {
            "round_id": 1,
            "initial_state": {**state, "attackers_loadout_value": 8000,
                              "defenders_loadout_value": 8000},
            "events": [{
                "type": "kill", "time_ms": 500, "killer_id": "killer", "victim_id": "victim",
                "before": state, "after": {**state, "defenders_alive": 1}, **damage,
            }],
        }
        return match, result, timeline

    def score_kill(self, before=0.4, after=0.6, **damage):
        match, _, timeline = self.round_fixture(**damage)
        return calculate_match(Model(before, after), match, [timeline])

    def assert_scores(self, rows, expected, version):
        self.assertEqual([row["ssversion"] for row in rows], [version] * len(rows))
        for row, points in zip(rows, expected, strict=True):
            self.assertAlmostEqual(row["swingscore"], points)

    def test_damage_share_conserves_swing(self):
        self.assert_scores(
            self.score_kill(damage_by_player={"killer": 30, "helper": 90}),
            (12.5, 7.5, -20), "1.2",
        )

    def test_negative_swing_is_not_shared(self):
        self.assert_scores(
            self.score_kill(0.6, 0.4, damage_by_player={"killer": 30, "helper": 90}),
            (-20, 0, 20), "1.2",
        )

    def test_missing_damage_uses_legacy_version(self):
        self.assert_scores(self.score_kill(), (20, 0, -20), "1.1")

    def test_opposing_team_damage_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid damage_by_player"):
            self.score_kill(damage_by_player={"killer": 30, "victim": 90})

    def test_terminal_kill_is_scored_and_ends_training_samples(self):
        for kill_time in (900, 1000):
            with self.subTest(kill_time=kill_time):
                match, result, timeline = self.round_fixture(damage_by_player={"killer": 100})
                kill = timeline["events"][0]
                initial = timeline["initial_state"]
                initial["defenders_alive"] = 1
                kill["time_ms"] = kill_time
                kill["before"]["defenders_alive"] = 1
                kill["after"]["defenders_alive"] = 0
                timeline["events"].append({**kill, "time_ms": kill_time})

                training_rows = list(iter_round_rows(match, timeline, result))
                self.assertEqual(len(training_rows), 1)
                self.assert_scores(calculate_match(Model(0.4, 0.6), match, [timeline]),
                                   (60, 0, -60), "1.2")

    def test_live_kill_at_round_end_is_used_and_later_kills_are_ignored(self):
        match, result, timeline = self.round_fixture(damage_by_player={"killer": 100})
        kill = timeline["events"][0]
        kill["time_ms"] = result["end_time_ms"]
        timeline["events"].append({**kill, "time_ms": kill["time_ms"] + 1})

        training_rows = list(iter_round_rows(match, timeline, result))
        self.assertEqual(len(training_rows), 2)
        self.assertEqual(training_rows[-1][:2], (2, 1))
        self.assert_scores(calculate_match(Model(0.4, 0.6), match, [timeline]),
                           (20, 0, -20), "1.2")

    def test_attackers_wiped_after_plant_still_use_model(self):
        match, result, timeline = self.round_fixture()
        result["winner_team_id"] = "Blue"
        kill = timeline["events"][0]
        kill.update(killer_id="victim", victim_id="killer", damage_by_player={"victim": 100})
        timeline["initial_state"]["attackers_alive"] = 1
        kill["before"]["attackers_alive"] = 1
        kill["after"] = {**kill["before"], "attackers_alive": 0}
        timeline["events"] = [
            {"type": "spike_planted", "time_ms": 200, "site": "A", "after": kill["before"]},
            kill,
            {"type": "spike_defused", "time_ms": 700},
            {**kill, "time_ms": 700},
        ]

        training_rows = list(iter_round_rows(match, timeline, result))
        self.assertEqual(len(training_rows), 3)
        self.assertEqual(training_rows[-1][:5], (0, 2, 44.7, True, 44.7))
        self.assert_scores(calculate_match(Model(0.4, 0.25), match, [timeline]),
                           (-15, 0, 15), "1.2")

    def test_unfinished_round_without_kills_counts_in_score_average(self):
        match, result, timeline = self.round_fixture(damage_by_player={"killer": 100})
        unfinished = {**result, "round_id": 2, "winner_team_id": None, "end_time_ms": None}
        unfinished_timeline = {**timeline, "round_id": 2, "events": []}
        match["rounds"].append(unfinished)

        self.assertEqual(list(iter_round_rows(match, unfinished_timeline, unfinished)), [])
        self.assert_scores(calculate_match(Model(0.4, 0.6), match, [timeline, unfinished_timeline]),
                           (10, 0, -10), "1.2")


class RatingTests(unittest.TestCase):
    players = [
        {"player_id": player, "team_id": team}
        for player, team in (("entry", "Red"), ("trader", "Red"), ("enemy", "Blue"))
    ]

    def round(self, events, winner="Red"):
        return {
            "result": {"round_id": 1, "end_time_ms": 9_000, "winner_team_id": winner,
                       "attacker_team_id": "Red", "defender_team_id": "Blue"},
            "timeline": {"initial_state": {"attackers_loadout_value": 4_000,
                                           "defenders_loadout_value": 20_000},
                         "events": events},
        }

    def kill(self, killer, victim, time):
        return {"type": "kill", "killer_id": killer, "victim_id": victim, "time_ms": time}

    def test_economy_trade_cutoff_and_swing_attribution(self):
        opening = self.kill("enemy", "entry", 1_000)
        trade = self.kill("trader", "enemy", 6_000)
        evaluated = {1: [(opening, 5.0, {}), (trade, 20.0, {"entry": 30, "trader": 90})]}
        rows = rating_components(self.players, [self.round([opening, trade])], evaluated)
        self.assertGreater(rows["trader"][0], rows["enemy"][0])
        self.assertGreater(rows["entry"][2], rows["enemy"][2])
        self.assertEqual(rows["entry"][3], 1.0)
        self.assertEqual([rows[p][-1] for p in ("entry", "trader", "enemy")], [2.5, 17.5, -20])
        late = self.kill("trader", "enemy", 6_001)
        rows = rating_components(self.players, [self.round([opening, late])], {})
        self.assertEqual(rows["entry"][3], 0.0)

    def test_revive_and_unfinished_rounds(self):
        opening = self.kill("enemy", "entry", 1_000)
        revive = {"type": "revive", "target_id": "entry", "time_ms": 2_000}
        completed = self.round([opening, revive])
        unfinished = self.round([opening], winner=None)
        rows = rating_components(self.players, [completed, unfinished], {})
        self.assertEqual(rows["entry"][3], 1.0)
        self.assertEqual(calculate_ratings(self.players, [unfinished], {}), {})
        scores = calculate_ratings(self.players, [completed], {})
        self.assertAlmostEqual(sum(scores.values()) / len(scores), 1.0)
