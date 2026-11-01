"""The replayed rules on made-up candles: python3 -m unittest research/test_signals.py"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import signals as s  # noqa: E402


def flat(minutes: int, price: float = 100.0, volume: float = 10_000.0) -> dict:
    """A quiet market: one price, the same volume every minute (14.4M a day)."""
    return {
        "t": np.arange(minutes, dtype=np.int64) * 60_000,
        "open": np.full(minutes, price), "high": np.full(minutes, price), "low": np.full(minutes, price),
        "close": np.full(minutes, price), "qv": np.full(minutes, volume),
    }


class RulesTest(unittest.TestCase):

    def test_a_three_percent_jump_in_five_minutes_is_a_pump_and_is_followed(self):
        c = flat(1600)
        # minutes 1500..1504 climb 3% in total, then the price stays there
        for k, i in enumerate(range(1500, 1505)):
            c["open"][i] = 100 * (1 + 0.006 * k)
            c["close"][i] = c["high"][i] = 100 * (1 + 0.006 * (k + 1))
        c["open"][1505:] = c["high"][1505:] = c["low"][1505:] = c["close"][1505:] = 103.0
        df = s.features(c)
        fired = s.admit(s.candidates(df))
        pumps = [f for f in fired if f[1] == "pump"]
        # the first minute at or past 2% fires; the cooldown holds back the rest of the climb
        self.assertEqual([f[0] for f in pumps], [1503])
        self.assertAlmostEqual(df["r60"].iat[1503], (103 / 102.4 - 1) * 100)

    def test_volume_needs_a_busier_market_than_the_moves(self):
        c = flat(1600)
        c["qv"][1590:1595] = 100_000.0  # ten times the pace for five minutes
        df = s.features(c)
        # 14.4M a day: enough for pumps (5M), not for volume (20M)
        self.assertFalse([x for x in s.candidates(df) if x[1] == "volume"])
        c["qv"] *= 2
        df = s.features(c)
        self.assertTrue([x for x in s.candidates(df) if x[1] == "volume"])

    def test_a_repeat_inside_the_cooldown_fires_only_if_much_stronger(self):
        found = [(100, "pump", 2.1, 1), (103, "pump", 2.5, 1), (105, "pump", 3.2, 1), (115, "pump", 2.0, 1)]
        self.assertEqual([f[0] for f in s.admit(found)], [100, 105, 115])

    def test_one_symbol_fires_at_most_four_times_an_hour(self):
        found = [(i * 11, "pump", 2.0, 1) for i in range(6)]
        self.assertEqual(len(s.admit(found)), 4)

    def test_a_move_from_outside_the_days_range_is_not_real(self):
        c = flat(1600)
        # one broken candle opens far below anything the market traded, as fresh listings do
        c["open"][1500] = 50.0
        df = s.features(c)
        self.assertFalse(df["within_day"].iat[1504] and df["ch5"].iat[1504] > 0)


if __name__ == "__main__":
    unittest.main()
