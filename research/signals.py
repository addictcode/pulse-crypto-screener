"""
Do Pulse's price signals predict anything? A replay of the PUMP, DUMP and VOLUME rules of
dev.pulse.signal.SignalRules on archived one-minute candles, with what the price did 5, 15 and 60
minutes later, split in time into a half to look at and a half to check on.

    python3 research/signals.py                       # 150 pairs, 2026-08-01 .. 2026-10-30
    python3 research/signals.py --pairs 80 --start 2026-09-01 --end 2026-10-30

Writes the tables into research/signals-2026-10.md between the markers, leaving the text around
them alone. Candles are cached in research/.cache (see archive.py).

Only a report: the rules in the backend are not touched by this.
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import archive

# --- the rules, as in SignalRules, SignalType and Cooldowns -------------------------------------
MOVE_FLOOR = 2.0            # PUMP / DUMP: % in 5 minutes
SURGE_FLOOR = 4.0           # VOLUME: last 5 minutes against the hourly pace
MIN_VOLUME_24H = 5e6        # pulse.signals.min-volume24h
VOLUME_LIQUIDITY_FACTOR = 4  # VOLUME wants 4x that
RANGE_SLACK = 0.02          # withinDay
COOLDOWN_MIN = {"pump": 10, "dump": 10, "volume": 30}
ESCALATION = 1.5            # a repeat inside the cooldown fires if this much stronger
BUDGET_PER_HOUR = 4         # signals per symbol per hour, all types

HORIZONS = (5, 15, 60)
PRIMARY = 60                # the verdicts are taken on the hour, as the record page does
FEES = 0.10                 # % round trip: 0.05% taker each side, as the setup journal counts
BOOTSTRAP = 4000
SEED = 7

REPORT = Path(__file__).resolve().parent / "signals-2026-10.md"
START_MARK, END_MARK = "<!-- tables:start -->", "<!-- tables:end -->"


def features(c: dict[str, np.ndarray]) -> pd.DataFrame:
    """The metrics the rules read, per minute, computed at the close of that minute."""
    df = pd.DataFrame(c)
    o, h, lo, cl, qv = df["open"], df["high"], df["low"], df["close"], df["qv"]
    # MetricsCalculator.changePct(5): from the open of the candle that started 5 minutes ago
    reference = o.shift(4)
    df["ch5"] = (cl / reference - 1) * 100
    # MetricsCalculator.surge: last 5 minutes against the average 5 minutes of the hour before
    recent = qv.rolling(5, min_periods=5).sum()
    before = qv.shift(5)
    base_sum = before.rolling(60, min_periods=30).sum()
    base_n = before.rolling(60, min_periods=30).count()
    df["surge"] = recent / (base_sum / base_n * 5)
    # the exchange's rolling 24 hour ticker
    df["vol24"] = qv.rolling(1440, min_periods=1440).sum()
    high24 = h.rolling(1440, min_periods=1).max()
    low24 = lo.rolling(1440, min_periods=1).min()
    df["within_day"] = (reference <= high24 * (1 + RANGE_SLACK)) & (reference >= low24 * (1 - RANGE_SLACK))
    # context for the hypotheses: the 4 hours before the move itself
    df["trend4h"] = (cl.shift(5) / cl.shift(245) - 1) * 100
    for horizon in HORIZONS:
        df[f"r{horizon}"] = (cl.shift(-horizon) / cl - 1) * 100
    return df


def candidates(df: pd.DataFrame) -> list[tuple[int, str, float, int]]:
    """(minute index, type, value, direction) wherever a rule holds, before any cooldown."""
    liquid = df["vol24"] >= MIN_VOLUME_24H
    real = df["ch5"].notna() & df["within_day"]
    out: list[tuple[int, str, float, int]] = []
    for i in np.flatnonzero((liquid & real & (df["ch5"] >= MOVE_FLOOR)).to_numpy()):
        out.append((i, "pump", df["ch5"].iat[i], 1))
    for i in np.flatnonzero((liquid & real & (-df["ch5"] >= MOVE_FLOOR)).to_numpy()):
        out.append((i, "dump", -df["ch5"].iat[i], -1))
    busy = (df["vol24"] >= MIN_VOLUME_24H * VOLUME_LIQUIDITY_FACTOR) & (df["surge"] >= SURGE_FLOOR)
    for i in np.flatnonzero(busy.to_numpy()):
        ch5 = df["ch5"].iat[i]
        out.append((i, "volume", df["surge"].iat[i], 0 if np.isnan(ch5) else int(np.sign(ch5))))
    return out


def admit(found: list[tuple[int, str, float, int]]) -> list[tuple[int, str, float, int]]:
    """Cooldowns.admit for one symbol: per type cooldown with escalation, then the hourly budget."""
    floors = {"pump": MOVE_FLOOR, "dump": MOVE_FLOOR, "volume": SURGE_FLOOR}
    # within a minute the detector takes the strongest first
    found.sort(key=lambda x: (x[0], -x[2] / floors[x[1]]))
    last: dict[str, tuple[int, float]] = {}
    fired_at: list[int] = []
    fired = []
    for i, kind, value, direction in found:
        previous = last.get(kind)
        fresh = previous is None or i - previous[0] >= COOLDOWN_MIN[kind] or value >= previous[1] * ESCALATION
        recent = [t for t in fired_at if i - t < 60]
        if not fresh or len(recent) >= BUDGET_PER_HOUR:
            continue
        last[kind] = (i, value)
        fired_at = recent + [i]
        fired.append((i, kind, value, direction))
    return fired


def replay(symbols: list[str], start: date, end: date) -> pd.DataFrame:
    rows = []
    # a day before the period for the 24 hour volume and the hourly baselines
    for n, symbol in enumerate(symbols, 1):
        df = features(archive.candles(symbol, start - timedelta(days=1), end))
        period_start = int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp() * 1000)
        for i, kind, value, direction in admit(candidates(df)):
            if df["t"].iat[i] < period_start:
                continue
            row = {"symbol": symbol, "t": int(df["t"].iat[i]) + 60_000, "type": kind, "value": value, "dir": direction,
                   "surge": df["surge"].iat[i], "vol24": df["vol24"].iat[i], "trend4h": df["trend4h"].iat[i]}
            for horizon in HORIZONS:
                row[f"r{horizon}"] = df[f"r{horizon}"].iat[i]
            rows.append(row)
        if n % 25 == 0:
            print(f"  {n}/{len(symbols)} pairs, {len(rows)} signals")
    signals = pd.DataFrame(rows)
    stamp = pd.to_datetime(signals["t"], unit="ms", utc=True)
    signals["day"] = stamp.dt.date
    signals["hour"] = stamp.dt.hour
    for horizon in HORIZONS:
        # the move in the signal's direction: + means the price went the way the signal pointed
        signals[f"m{horizon}"] = signals["dir"] * signals[f"r{horizon}"]
    return signals


# --- statistics ----------------------------------------------------------------------------------

@dataclass
class Estimate:
    n: int
    mean: float
    lo: float
    hi: float
    share: float

    def cell(self, digits: int = 3) -> str:
        if self.n == 0:
            return "–"
        return f"{self.mean:+.{digits}f} [{self.lo:+.{digits}f}; {self.hi:+.{digits}f}]"


def _per_day(frame: pd.DataFrame, column: str, days: list) -> tuple[np.ndarray, np.ndarray]:
    valid = frame[frame[column].notna()]
    grouped = valid.groupby("day")[column].agg(["sum", "count"]).reindex(days, fill_value=0)
    return grouped["sum"].to_numpy(float), grouped["count"].to_numpy(float)


def _resample(n_days: int, rng: np.random.Generator) -> np.ndarray:
    return rng.integers(0, n_days, (BOOTSTRAP, n_days))


def estimate(frame: pd.DataFrame, column: str, days: list, rng: np.random.Generator) -> Estimate:
    """
    Mean with a 95% interval from a bootstrap over days. Signals of one market-wide move are not
    independent: on a day when everything dumps, every dump "works". Resampling whole days keeps
    such bursts together, so the interval is honest about how few independent episodes there are.
    """
    sums, counts = _per_day(frame, column, days)
    total = counts.sum()
    if total == 0:
        return Estimate(0, np.nan, np.nan, np.nan, np.nan)
    idx = _resample(len(days), rng)
    with np.errstate(invalid="ignore", divide="ignore"):
        means = sums[idx].sum(1) / counts[idx].sum(1)
    lo, hi = np.nanpercentile(means, [2.5, 97.5])
    values = frame[column].dropna()
    return Estimate(int(total), sums.sum() / total, lo, hi, float((values > 0).mean()))


def difference(a: pd.DataFrame, b: pd.DataFrame, column: str, days: list, rng: np.random.Generator) -> Estimate:
    """Mean of a minus mean of b, both resampled on the same days."""
    sa, ca = _per_day(a, column, days)
    sb, cb = _per_day(b, column, days)
    if ca.sum() == 0 or cb.sum() == 0:
        return Estimate(0, np.nan, np.nan, np.nan, np.nan)
    idx = _resample(len(days), rng)
    with np.errstate(invalid="ignore", divide="ignore"):
        diffs = sa[idx].sum(1) / ca[idx].sum(1) - sb[idx].sum(1) / cb[idx].sum(1)
    lo, hi = np.nanpercentile(diffs, [2.5, 97.5])
    return Estimate(int(ca.sum() + cb.sum()), sa.sum() / ca.sum() - sb.sum() / cb.sum(), lo, hi, np.nan)


# --- the report ----------------------------------------------------------------------------------

LABELS = {"pump": "PUMP (памп)", "dump": "DUMP (дамп)", "volume": "VOLUME (объём, по знаку цены)"}


def base_table(signals: pd.DataFrame, halves: dict, rng: np.random.Generator) -> list[str]:
    lines = ["| Сигнал | Половина | n | Через 5 мин | Через 15 мин | Через 60 мин | Доля «в свою сторону», 60 мин |",
             "|---|---|---:|---:|---:|---:|---:|"]
    for kind in ("pump", "dump", "volume"):
        for name, (frame, days) in halves.items():
            part = frame[(frame["type"] == kind) & (frame["dir"] != 0)]
            cells = [estimate(part, f"m{h}", days, rng) for h in HORIZONS]
            lines.append(f"| {LABELS[kind]} | {name} | {cells[0].n} | " + " | ".join(c.cell() for c in cells)
                         + f" | {cells[-1].share:.0%} |")
    return lines


@dataclass
class Hypothesis:
    key: str
    title: str
    split: callable  # (moves, train) -> (group A mask, group B mask, label A, label B)


def hypotheses(train: pd.DataFrame) -> list[Hypothesis]:
    moves_train = train[train["type"].isin(["pump", "dump"])]
    # the liquidity line is drawn on the first half only, then applied unchanged to the second
    liquid_line = float(moves_train["vol24"].median())

    def by_volume(frame):
        return frame["surge"] >= SURGE_FLOOR, frame["surge"] < SURGE_FLOOR, "объём ≥ 4× часового темпа", "объём < 4×"

    def by_hour(frame):
        us = frame["hour"].between(13, 20)
        return us, ~us, "13–21 UTC (США)", "остальные часы"

    def by_trend(frame):
        aligned = np.sign(frame["trend4h"]) == frame["dir"]
        known = frame["trend4h"].notna() & (frame["trend4h"] != 0)
        return aligned & known, ~aligned & known, "по тренду 4 ч", "против тренда 4 ч"

    def by_liquidity(frame):
        big = frame["vol24"] >= liquid_line
        return big, ~big, f"оборот ≥ ${liquid_line / 1e6:.0f}M", f"оборот < ${liquid_line / 1e6:.0f}M"

    return [
        Hypothesis("H1", "Объём подтверждает движение: памп или дамп на всплеске объёма идёт дальше, чем без него", by_volume),
        Hypothesis("H2", "Время суток: в часы США (13–21 UTC) движение продолжается сильнее", by_hour),
        Hypothesis("H3", "Тренд старшего таймфрейма: движение по направлению 4-часового тренда продолжается, против — откатывается", by_trend),
        Hypothesis("H4", "Ликвидность: на оборотистых монетах движение продолжается сильнее, чем на тонких", by_liquidity),
    ]


def hypothesis_tables(halves: dict, train: pd.DataFrame, rng: np.random.Generator) -> tuple[list[str], list[str]]:
    lines: list[str] = []
    verdicts: list[str] = []
    for hyp in hypotheses(train):
        lines += [f"### {hyp.key}. {hyp.title}", "",
                  "| Половина | Группа | n | Через 5 мин | Через 15 мин | Через 60 мин |", "|---|---|---:|---:|---:|---:|"]
        results = {}
        for name, (frame, days) in halves.items():
            moves = frame[frame["type"].isin(["pump", "dump"])]
            in_a, in_b, label_a, label_b = hyp.split(moves)
            a, b = moves[in_a], moves[in_b]
            for label, group in ((label_a, a), (label_b, b)):
                cells = [estimate(group, f"m{h}", days, rng) for h in HORIZONS]
                lines.append(f"| {name} | {label} | {cells[0].n} | " + " | ".join(c.cell() for c in cells) + " |")
            diffs = [difference(a, b, f"m{h}", days, rng) for h in HORIZONS]
            lines.append(f"| {name} | **разница** | | " + " | ".join(d.cell() for d in diffs) + " |")
            results[name] = diffs[HORIZONS.index(PRIMARY)]
        train_d, test_d = results["обучающая"], results["проверочная"]
        holds = test_d.lo > 0 or test_d.hi < 0
        same_sign = np.sign(train_d.mean) == np.sign(test_d.mean)
        if holds and same_sign:
            verdict = "**есть эффект** на проверочной половине"
        elif holds:
            verdict = "на проверочной половине разница есть, но **с другим знаком**, чем на обучающей — эффекта нет"
        else:
            verdict = "**нет эффекта** на проверочной половине: интервал разницы накрывает ноль"
        line = f"{hyp.key}: {verdict} (разница через {PRIMARY} мин {test_d.cell()} п.п.; на обучающей {train_d.cell()})."
        verdicts.append(line)
        lines += ["", f"Вывод: {line}", ""]
    return lines, verdicts


def write_report(signals: pd.DataFrame, symbols: list[str], start: date, end: date) -> None:
    rng = np.random.default_rng(SEED)
    middle = start + (end - start + timedelta(days=1)) / 2
    train = signals[signals["day"] < middle]
    test = signals[signals["day"] >= middle]
    all_days = [start + timedelta(days=k) for k in range((end - start).days + 1)]
    halves = {"обучающая": (train, [d for d in all_days if d < middle]),
              "проверочная": (test, [d for d in all_days if d >= middle])}

    counts = signals.groupby("type").size()
    lines = [
        START_MARK,
        "",
        f"Период {start} — {end} ({len(all_days)} дн.), {len(symbols)} пар. Обучающая половина — до {middle}, "
        f"проверочная — с {middle}. Сигналов после кулдаунов: {len(signals)} "
        f"(PUMP {counts.get('pump', 0)}, DUMP {counts.get('dump', 0)}, VOLUME {counts.get('volume', 0)}).",
        "",
        "Клетка — средний ход цены **в сторону сигнала** в процентах (у дампа падение считается плюсом) и 95% "
        "интервал бутстрэпом по дням. Комиссия не вычтена: круг туда-обратно стоит около "
        f"{FEES:.2f}%, то есть ход меньше {FEES:.2f}% не окупает сделку даже без проскальзывания.",
        "",
        "## Сами сигналы",
        "",
        *base_table(signals, halves, rng),
        "",
        "## Гипотезы (PUMP и DUMP вместе)",
        "",
    ]
    hyp_lines, verdicts = hypothesis_tables(halves, train, rng)
    lines += hyp_lines
    lines += ["## Итог по гипотезам", "", *[f"- {v}" for v in verdicts], "", END_MARK]

    text = REPORT.read_text() if REPORT.exists() else f"# Сигналы Pulse на архиве\n\n{START_MARK}\n{END_MARK}\n"
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
    print(f"{len(symbols)} pairs, {args.start} .. {args.end}")
    archive.prefetch(symbols, args.start - timedelta(days=1), args.end)
    signals = replay(symbols, args.start, args.end)
    if args.save:
        signals.to_csv(args.save, index=False)
    write_report(signals, symbols, args.start, args.end)


if __name__ == "__main__":
    main()
