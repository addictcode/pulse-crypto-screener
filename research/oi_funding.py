"""
Open interest and funding signals on Binance's archive, and a second question for every signal:
not "which way next" (signals.py answered that: no), but "does the market move more than usual
after it". A replay of the OPEN_INTEREST and FUNDING rules of dev.pulse.signal.SignalRules, plus
PUMP, DUMP and VOLUME as in signals.py, on the same pairs and period.

    python3 research/oi_funding.py                     # 150 pairs, 2026-08-01 .. 2026-10-30
    python3 research/oi_funding.py --pairs 40 --save /tmp/oi.csv

Writes the tables into research/oi-funding-2026-11.md between the markers. Only a report: the
rules in the backend are not touched by this.

What the archive can and cannot show:
- open interest: a point every 5 minutes (daily "metrics" files); the live server polls more
  often, so a live signal can come a few minutes earlier than here;
- funding: only the settled rates (every 8 hours, on some pairs 4 or 1), not the predicted rate
  between settlements that the live rule reads. A settlement at 0.1% or more stands in for it;
- liquidations are not in the public archive at all, so the LIQUIDATIONS signal is left out.
"""
from __future__ import annotations

import argparse
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archive  # noqa: E402
import signals as base  # noqa: E402
from signals import BUDGET_PER_HOUR, ESCALATION, FEES, SEED, Estimate, estimate  # noqa: E402

# --- the rules, as in SignalRules and SignalType ------------------------------------------------
OI_FLOOR = 4.0              # % change of open interest in 15 minutes
OI_MINUTES = 15
FUNDING_FLOOR = 0.1         # % per settlement, either side of zero
FLOORS = {"pump": base.MOVE_FLOOR, "dump": base.MOVE_FLOOR, "volume": base.SURGE_FLOOR, "oi": OI_FLOOR, "funding": FUNDING_FLOOR}
COOLDOWN_MIN = {**base.COOLDOWN_MIN, "oi": 30, "funding": 240}

HORIZONS = (15, 60, 240)
ACTIVITY = 60               # the "does it move more" question is asked on the hour
BASELINE_MINUTES = 1440     # "usual" is the day before the signal

KINDS = ("pump", "dump", "volume", "oi", "funding")
LABELS = {"pump": "PUMP", "dump": "DUMP", "volume": "VOLUME", "oi": "OPEN_INTEREST", "funding": "FUNDING"}

REPORT = Path(__file__).resolve().parent / "oi-funding-2026-11.md"
START_MARK, END_MARK = "<!-- tables:start -->", "<!-- tables:end -->"


def oi_candidates(t: np.ndarray, oi_t: np.ndarray, oi_v: np.ndarray, liquid: np.ndarray) -> list[tuple[int, str, float, int]]:
    """MetricsCalculator.openInterestChangePct(15) at every archived point, on the minute grid `t`."""
    out = []
    if len(oi_t) < 2:
        return out
    # the newest point at least 15 minutes old, as the live rule takes it
    ref = np.searchsorted(oi_t, oi_t - OI_MINUTES * 60_000, side="right") - 1
    for k in np.flatnonzero(ref >= 0):
        if oi_v[ref[k]] <= 0:
            continue
        change = (oi_v[k] / oi_v[ref[k]] - 1) * 100
        if abs(change) < OI_FLOOR:
            continue
        # the point is known at its time: the signal sits on the minute that closed then
        i = (oi_t[k] - t[0]) // 60_000 - 1
        if 0 <= i < len(t) and liquid[i]:
            out.append((int(i), "oi", abs(change), int(np.sign(change))))
    return out


def funding_candidates(t: np.ndarray, f_t: np.ndarray, f_rate: np.ndarray, liquid: np.ndarray) -> list[tuple[int, str, float, int]]:
    """Settlements at 0.1% or more, either side; positive funding means longs pay, the crowd is long."""
    out = []
    for when, rate in zip(f_t, f_rate):
        pct = rate * 100
        if abs(pct) < FUNDING_FLOOR:
            continue
        i = (when - t[0]) // 60_000 - 1
        if 0 <= i < len(t) and liquid[i]:
            out.append((int(i), "funding", abs(pct), int(np.sign(pct))))
    return out


def admit(found: list[tuple[int, str, float, int]]) -> list[tuple[int, str, float, int]]:
    """Cooldowns.admit for one symbol over all five types: cooldown with escalation, hourly budget."""
    found.sort(key=lambda x: (x[0], -x[2] / FLOORS[x[1]]))
    last: dict[str, tuple[int, float]] = {}
    fired_at: list[int] = []
    fired = []
    for i, kind, value, direction in found:
        previous = last.get(kind)
        fresh = previous is None or i - previous[0] >= COOLDOWN_MIN[kind] or value >= previous[1] * ESCALATION
        recent = [x for x in fired_at if i - x < 60]
        if not fresh or len(recent) >= BUDGET_PER_HOUR:
            continue
        last[kind] = (i, value)
        fired_at = recent + [i]
        fired.append((i, kind, value, direction))
    return fired


def replay_symbol(symbol: str, start: date, end: date) -> list[dict]:
    first = start - timedelta(days=2)  # a day for the 24 hour volume, a day for the baseline
    df = base.features(archive.candles(symbol, first, end))
    close = df["close"]
    for h in HORIZONS:
        df[f"r{h}"] = (close.shift(-h) / close - 1) * 100
    # how much the price usually moves in an hour: |r60| over the day before, using only minutes
    # whose hour had ended before the signal (j + 60 <= i), so nothing after the signal leaks in
    moved = df[f"r{ACTIVITY}"].abs()
    df["usual"] = moved.shift(ACTIVITY).rolling(BASELINE_MINUTES, min_periods=BASELINE_MINUTES // 2).mean()

    t = df["t"].to_numpy()
    liquid = (df["vol24"] >= base.MIN_VOLUME_24H).to_numpy()
    oi_t, oi_v = archive.open_interest(symbol, first, end)
    f_t, f_rate, _ = archive.funding(symbol, first, end)
    found = base.candidates(df) + oi_candidates(t, oi_t, oi_v, liquid) + funding_candidates(t, f_t, f_rate, liquid)

    period_start = int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp() * 1000)
    rows = []
    for i, kind, value, direction in admit(found):
        if t[i] < period_start:
            continue
        row = {"symbol": symbol, "t": int(t[i]) + 60_000, "type": kind, "value": value, "dir": direction,
               "usual": df["usual"].iat[i]}
        for h in HORIZONS:
            row[f"r{h}"] = df[f"r{h}"].iat[i]
        rows.append(row)
    return rows


def replay(symbols: list[str], start: date, end: date) -> pd.DataFrame:
    rows: list[dict] = []
    for n, symbol in enumerate(symbols, 1):
        rows += replay_symbol(symbol, start, end)
        if n % 25 == 0:
            print(f"  {n}/{len(symbols)} pairs, {len(rows)} signals", flush=True)
    return measure(pd.DataFrame(rows))


def measure(signals: pd.DataFrame) -> pd.DataFrame:
    """The columns the tables read: the day, moves in the signal's direction, and how unusual the hour was."""
    signals = signals.copy()
    signals["day"] = pd.to_datetime(signals["t"], unit="ms", utc=True).dt.date
    for h in HORIZONS:
        signals[f"m{h}"] = signals["dir"] * signals[f"r{h}"]
    with np.errstate(divide="ignore", invalid="ignore"):
        signals["act"] = signals[f"r{ACTIVITY}"].abs() / signals["usual"]
    signals.loc[~np.isfinite(signals["act"]), "act"] = np.nan
    return signals


# --- the report ----------------------------------------------------------------------------------

def direction_table(halves: dict, rng: np.random.Generator) -> list[str]:
    lines = ["| Сигнал | Половина | n | Через 15 мин | Через 60 мин | Через 240 мин | Доля «в свою сторону», 60 мин |",
             "|---|---|---:|---:|---:|---:|---:|"]
    for kind in KINDS:
        for name, (frame, days) in halves.items():
            part = frame[(frame["type"] == kind) & (frame["dir"] != 0)]
            cells = [estimate(part, f"m{h}", days, rng) for h in HORIZONS]
            share = "–" if cells[1].n == 0 else f"{cells[1].share:.0%}"
            lines.append(f"| {LABELS[kind]} | {name} | {cells[1].n} | " + " | ".join(c.cell() for c in cells) + f" | {share} |")
    return lines


def activity_table(halves: dict, rng: np.random.Generator) -> list[str]:
    lines = ["| Сигнал | Половина | n | Размах часа к обычному | Доля часов живее обычного |",
             "|---|---|---:|---:|---:|"]
    for kind in KINDS:
        for name, (frame, days) in halves.items():
            part = frame[frame["type"] == kind]
            e = estimate(part, "act", days, rng)
            share = "–" if e.n == 0 else f"{(part['act'].dropna() > 1).mean():.0%}"
            cell = "–" if e.n == 0 else f"×{e.mean:.2f} [×{e.lo:.2f}; ×{e.hi:.2f}]"
            lines.append(f"| {LABELS[kind]} | {name} | {e.n} | {cell} | {share} |")
    return lines


def verdicts(halves: dict, rng: np.random.Generator) -> list[str]:
    """Plain words, taken on the checking half only."""
    frame, days = halves["проверочная"]
    out = []
    for kind in KINDS:
        part = frame[frame["type"] == kind]
        d = estimate(part[part["dir"] != 0], "m60", days, rng)
        a = estimate(part, "act", days, rng)
        if d.n == 0:
            out.append(f"{LABELS[kind]}: на проверочной половине сигналов нет.")
            continue
        if d.lo > 0:
            way = f"цена через час шла в сторону сигнала ({d.mean:+.2f}%" + (")" if d.lo > FEES else f", но не надёжно больше комиссии ~{FEES:.2f}%)")
        elif d.hi < 0:
            way = f"цена через час шла против сигнала ({d.mean:+.2f}%)"
        else:
            way = f"направление через час неотличимо от монетки ({d.mean:+.2f}%, интервал накрывает 0)"
        if a.n == 0:
            moved = "размах не посчитать"
        elif a.lo > 1:
            moved = f"а час после него живее обычного в ×{a.mean:.1f} раза (интервал выше ×1)"
        elif a.hi < 1:
            moved = f"а час после него спокойнее обычного (×{a.mean:.2f})"
        else:
            moved = f"а размах часа не отличим от обычного (×{a.mean:.2f})"
        out.append(f"{LABELS[kind]} (n={d.n}): {way}; {moved}.")
    return out


def write_report(signals: pd.DataFrame, symbols: list[str], start: date, end: date) -> None:
    rng = np.random.default_rng(SEED)
    middle = start + (end - start + timedelta(days=1)) / 2
    all_days = [start + timedelta(days=k) for k in range((end - start).days + 1)]
    halves = {"обучающая": (signals[signals["day"] < middle], [d for d in all_days if d < middle]),
              "проверочная": (signals[signals["day"] >= middle], [d for d in all_days if d >= middle])}
    counts = signals.groupby("type").size()
    lines = [
        START_MARK,
        "",
        f"Период {start} — {end} ({len(all_days)} дн.), {len(symbols)} пар. Обучающая половина — до {middle}, "
        f"проверочная — с {middle}. Сигналов после кулдаунов: {len(signals)} ("
        + ", ".join(f"{LABELS[k]} {counts.get(k, 0)}" for k in KINDS) + ").",
        "",
        "## Направление",
        "",
        "Клетка — средний ход цены **в сторону сигнала** в процентах и 95% интервал бутстрэпом по дням. Сторона: у "
        "OPEN_INTEREST — знак изменения OI (рост OI — «вверх»), у FUNDING — знак ставки (платят лонги — «вверх», "
        f"толпа в лонгах). Комиссия не вычтена: круг стоит около {FEES:.2f}%.",
        "",
        *direction_table(halves, rng),
        "",
        "## Размах",
        "",
        f"Клетка — во сколько раз ход цены за час после сигнала (по модулю) больше обычного часа этой же пары за сутки "
        "до сигнала, средний и 95% интервал. ×1 — обычный час, ×2 — вдвое живее.",
        "",
        *activity_table(halves, rng),
        "",
        "## Итог по проверочной половине",
        "",
        *[f"- {v}" for v in verdicts(halves, rng)],
        "",
        END_MARK,
    ]
    text = REPORT.read_text() if REPORT.exists() else f"# OI и фандинг на архиве\n\n{START_MARK}\n{END_MARK}\n"
    pattern = re.compile(re.escape(START_MARK) + ".*?" + re.escape(END_MARK), re.S)
    REPORT.write_text(pattern.sub(lambda _: "\n".join(lines), text))
    print(f"wrote {REPORT}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pairs", type=int, default=150, help="most liquid crypto perpetuals on the last day")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2026, 8, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2026, 10, 30))
    parser.add_argument("--save", type=Path, help="also write every replayed signal to this CSV")
    args = parser.parse_args()

    ranked = archive.rank_by_volume(archive.crypto_symbols(), args.end)
    symbols = [s for s, volume in ranked[: args.pairs] if volume > 0]
    print(f"{len(symbols)} pairs, {args.start} .. {args.end}", flush=True)
    first = args.start - timedelta(days=2)
    archive.prefetch(symbols, first, args.end)
    # open interest comes as a file a day: fetched in parallel, or the replay waits on each
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda s: (archive.open_interest(s, first, args.end), archive.funding(s, first, args.end)), symbols))
    print("open interest and funding fetched", flush=True)
    signals = replay(symbols, args.start, args.end)
    if args.save:
        signals.to_csv(args.save, index=False)
    write_report(signals, symbols, args.start, args.end)


if __name__ == "__main__":
    main()
