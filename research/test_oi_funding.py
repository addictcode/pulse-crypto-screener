"""The open interest and funding rules on made-up data: python3 -m unittest research/test_oi_funding.py"""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oi_funding as o  # noqa: E402

T0 = 1_790_812_800_000  # midnight UTC
MIN = 60_000


def grid(minutes: int = 600) -> np.ndarray:
    return T0 + np.arange(minutes, dtype=np.int64) * MIN


class OpenInterestTest(unittest.TestCase):

    def test_a_jump_against_the_newest_point_at_least_15_minutes_old_fires(self):
        t = grid()
        oi_t = T0 + np.arange(0, 120, 5, dtype=np.int64) * MIN
        oi_v = np.full(len(oi_t), 1000.0)
        oi_v[10:] = 1050.0  # +5% at minute 50, measured against minute 35 (15 minutes before)
        found = o.oi_candidates(t, oi_t, oi_v, np.ones(len(t), bool))
        # minute 50 fires, minute 55 (against 40) too, minute 65 (against 50) no longer
        self.assertEqual([(i, d) for i, _, _, d in found], [(49, 1), (54, 1), (59, 1)])
        self.assertAlmostEqual(found[0][2], 5.0)

    def test_a_fall_points_down_and_a_small_move_is_nothing(self):
        t = grid()
        oi_t = T0 + np.arange(0, 60, 5, dtype=np.int64) * MIN
        oi_v = np.array([1000, 1000, 1000, 1000, 960, 960, 980, 980, 990, 990, 990, 990], float)
        found = o.oi_candidates(t, oi_t, oi_v, np.ones(len(t), bool))
        self.assertEqual({d for *_, d in found}, {-1})
        self.assertTrue(all(abs(v - 4.0) < 1e-9 for _, _, v, _ in found))

    def test_a_thin_market_does_not_count(self):
        t = grid()
        oi_t = T0 + np.arange(0, 60, 5, dtype=np.int64) * MIN
        oi_v = np.r_[np.full(6, 1000.0), np.full(6, 1100.0)]
        self.assertEqual(o.oi_candidates(t, oi_t, oi_v, np.zeros(len(t), bool)), [])


class FundingTest(unittest.TestCase):

    def test_only_settlements_at_a_tenth_of_a_percent_fire_and_the_sign_says_who_pays(self):
        t = grid(1440)
        f_t = T0 + np.array([0, 480, 960], dtype=np.int64) * MIN + 5
        found = o.funding_candidates(t, f_t, np.array([0.0001, 0.0012, -0.0015]), np.ones(len(t), bool))
        self.assertEqual([(i, d) for i, _, _, d in found], [(479, 1), (959, -1)])
        self.assertAlmostEqual(found[1][2], 0.15)


class AdmitTest(unittest.TestCase):

    def test_cooldowns_are_per_type_and_the_hour_holds_four(self):
        found = [(0, "oi", 4.5, 1), (10, "oi", 5.0, 1), (10, "funding", 0.2, 1), (31, "oi", 4.1, 1),
                 (32, "pump", 2.5, 1), (33, "dump", 2.5, -1), (34, "volume", 5.0, 1)]
        fired = o.admit(found)
        # 10: the second oi is inside 30 minutes and not 1.5 times stronger; 34: a fifth in the hour
        self.assertEqual([(i, k) for i, k, _, _ in fired], [(0, "oi"), (10, "funding"), (31, "oi"), (32, "pump")])


class MeasureTest(unittest.TestCase):

    def test_the_usual_hour_comes_only_from_before_the_signal(self):
        # a flat day, then the price doubles: the hour before the jump must still look calm
        close = np.r_[np.full(3000, 100.0), np.full(100, 200.0)]
        df = pd.DataFrame({"close": close})
        moved = ((df["close"].shift(-60) / df["close"] - 1) * 100).abs()
        usual = moved.shift(60).rolling(1440, min_periods=720).mean()
        self.assertEqual(usual.iat[2999], 0.0)  # the jump at 3000 is not in it
        self.assertGreater(usual.iat[3061], 0.0)

    def test_moves_count_the_signals_way_and_activity_is_against_the_usual_hour(self):
        frame = pd.DataFrame([{"t": T0, "type": "oi", "dir": -1, "r15": -0.5, "r60": -1.0, "r240": 1.0, "usual": 0.5}])
        m = o.measure(frame)
        self.assertEqual(m["m60"].iat[0], 1.0)
        self.assertEqual(m["m240"].iat[0], -1.0)
        self.assertEqual(m["act"].iat[0], 2.0)

    def test_no_usual_hour_means_no_ratio(self):
        frame = pd.DataFrame([{"t": T0, "type": "oi", "dir": 1, "r15": 0, "r60": 1.0, "r240": 0, "usual": 0.0}])
        self.assertTrue(np.isnan(o.measure(frame)["act"].iat[0]))


class ReplayTest(unittest.TestCase):

    def test_a_late_look_starts_five_minutes_after_the_archive_stamp(self):
        from datetime import date
        days = 4
        n = days * 1440
        t = T0 + np.arange(n, dtype=np.int64) * MIN
        close = np.full(n, 100.0)
        jump = 3 * 1440 + 600            # day 3, 10:00: open interest +5% and the price leaps at once
        close[jump:jump + 5] = 110.0     # the leap is over within five minutes
        close[jump + 5:] = 110.0
        candles = {"t": t, "open": close.copy(), "high": close * 1.0001, "low": close * 0.9999, "close": close,
                   "qv": np.full(n, 10_000.0)}
        oi_t = T0 + np.arange(0, n, 5, dtype=np.int64) * MIN
        # stamped at the start of the window in which the leap happens, as the archive may do
        oi_v = np.where(oi_t >= T0 + jump * MIN, 1050.0, 1000.0)
        saved = (o.archive.candles, o.archive.open_interest, o.archive.funding)
        try:
            o.archive.candles = lambda *a: candles
            o.archive.open_interest = lambda *a: (oi_t, oi_v)
            o.archive.funding = lambda *a: (np.array([], dtype=np.int64), np.array([]), np.array([]))
            rows = o.replay_symbol("TESTUSDT", date(2026, 10, 3), date(2026, 10, 4))
        finally:
            o.archive.candles, o.archive.open_interest, o.archive.funding = saved
        oi = [r for r in rows if r["type"] == "oi"]
        self.assertTrue(oi)
        first = oi[0]
        # as stamped, the signal sits right before the leap and "sees" it; five minutes late it is over
        self.assertGreater(first["r15"], 5)
        self.assertAlmostEqual(first["late_r15"], 0.0)


if __name__ == "__main__":
    unittest.main()
