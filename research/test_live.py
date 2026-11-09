"""The live report on made-up rows: python3 -m unittest research/test_live.py"""
import sys
import unittest
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import live  # noqa: E402

SINCE, UNTIL = date(2026, 11, 1), date(2026, 11, 20)


def rows(kind: str, direction: int, ret_1h: float | None, days: int = 20, start: str = "2026-11-01") -> list[dict]:
    """One signal a day at noon UTC, the price change an hour later as the table stores it."""
    return [{"type": kind, "symbol": "BTCUSDT", "fired_at": f"{d.date()}T12:00:00Z", "direction": direction,
             "ret_5m": None if ret_1h is None else ret_1h / 4, "ret_15m": None if ret_1h is None else ret_1h / 2,
             "ret_1h": ret_1h}
            for d in pd.date_range(start, periods=days, freq="D")]


class LiveTest(unittest.TestCase):

    def test_moves_are_counted_in_the_signals_direction(self):
        frame = live.prepare(pd.DataFrame(rows("DUMP", -1, -0.8)), SINCE, UNTIL)
        # a dump followed by a further fall of 0.8% went its way by +0.8
        self.assertTrue(np.allclose(frame["m60"], 0.8))
        self.assertTrue((frame["type"] == "dump").all())

    def test_only_the_clean_period_and_the_three_price_signals_count(self):
        raw = pd.DataFrame(rows("PUMP", 1, 1.0, days=5, start="2026-10-25")
                           + rows("PUMP", 1, 1.0, days=3)
                           + rows("FUNDING", 1, 1.0, days=3)
                           + rows("PUMP", 1, 1.0, days=2, start="2026-11-25"))
        frame = live.prepare(raw, SINCE, UNTIL)
        self.assertEqual(len(frame), 3)

    def test_verdicts_tell_a_follow_through_from_a_reversal_and_from_noise(self):
        raw = pd.DataFrame(rows("PUMP", 1, 1.0)
                           + rows("DUMP", -1, 0.5)
                           + [r for i in range(20) for r in rows("VOLUME", 1, 0.3 if i % 2 else -0.3, days=1,
                                                                   start=f"2026-11-{i + 1:02d}")])
        text = live.report(live.prepare(raw, SINCE, UNTIL), SINCE, UNTIL)
        self.assertIn("PUMP (памп): через час цена шла в сторону сигнала (+1.00%), и больше комиссии", text)
        self.assertIn("DUMP (дамп): через час цена шла против сигнала (-0.50%)", text)
        self.assertIn("VOLUME (объём, по знаку цены): через час ход неотличим от нуля", text)
        self.assertNotIn("Внимание", text)

    def test_signals_without_an_outcome_are_left_out_and_a_short_period_is_flagged(self):
        raw = pd.DataFrame(rows("PUMP", 1, 1.0, days=3) + rows("PUMP", 1, None, days=3))
        until = date(2026, 11, 3)
        text = live.report(live.prepare(raw, SINCE, until), SINCE, until)
        self.assertIn("с исходом через час: 3", text)
        self.assertIn("| PUMP (памп) | 3 |", text)
        self.assertIn("Внимание: дней меньше 14", text)

    def test_downtime_days_are_not_counted_and_signals_across_a_stop_are_left_out(self):
        # the real case: Pulse stood still from 2 November afternoon to the 5th in the morning
        raw = pd.DataFrame(rows("PUMP", 1, 1.0, days=20))
        uptime = pd.DataFrame({"started_at": ["2026-10-31T00:00:00Z", "2026-11-05T09:00:00Z"],
                               "last_seen_at": ["2026-11-02T11:30:00Z", "2026-11-21T00:00:00Z"]})
        frame = live.prepare(raw, SINCE, UNTIL)
        kept, days, dropped = live.apply_uptime(frame, uptime, SINCE, UNTIL)
        # 2 Nov noon: its hour runs into the stop at 11:30; 3 and 4 Nov: no signals were fired then
        # anyway in real life, but a made-up one would be inside the stop
        self.assertEqual(dropped, 3)
        self.assertEqual(len(kept), 17)
        self.assertNotIn(date(2026, 11, 3), days)
        self.assertNotIn(date(2026, 11, 4), days)
        self.assertIn(date(2026, 11, 2), days)
        self.assertIn(date(2026, 11, 5), days)
        self.assertEqual(len(days), 18)
        text = live.report(kept, SINCE, UNTIL, days, dropped)
        self.assertIn("Pulse работал 18 дн. из 20", text)
        self.assertIn("3 сигн.", text)

    def test_a_restart_a_minute_later_is_not_a_stop(self):
        uptime = pd.DataFrame({"started_at": ["2026-11-01T00:00:00Z", "2026-11-01T10:01:00Z"],
                               "last_seen_at": ["2026-11-01T10:00:00Z", "2026-11-02T00:00:00Z"]})
        self.assertEqual(live.downtime(uptime), [])


if __name__ == "__main__":
    unittest.main()
