import unittest

from calculate_report import calculate_ratings
from calculate_rating import rating_components
from calculate_swing import calculate_match
import numpy as np


class Model:
    def __init__(self, before, after):
        self.probabilities = np.array([before, after])

    def predict(self, features, *, validate_features):
        return self.probabilities


class SwingScoreTests(unittest.TestCase):
    def score_kill(self, before=0.4, after=0.6, **damage):
        result = {"round_id": 1, "attacker_team_id": "Red", "end_time_ms": 1000}
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
