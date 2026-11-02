"""
The archive study (signals.py) again, on the signals the live Pulse fired and stored: what the price
did 5, 15 and 60 minutes after each PUMP, DUMP and VOLUME signal, in the signal's direction, with
the same bootstrap over days. Run it after two or three weeks of clean data:

    python3 research/live.py --docker pulse-postgres-1          # read the stack's database
    python3 research/live.py --csv signals.csv                   # or an export made by hand

The export by hand, for a database that is not a local container:

    psql -U pulse -d pulse -c "\\copy (select type, symbol, fired_at, direction, ret_5m, ret_15m, ret_1h
        from signal) to stdout with csv header" > signals.csv

Prints the table in the format of signals-2026-10.md, to paste into a report. Only signals since
--since count (default 2026-10-31: stream frames from different pairs were spliced together before
that, and that history was deleted). Only a report: the rules in the backend are not touched.
"""
from __future__ import annotations

import argparse
import io
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from signals import FEES, HORIZONS, LABELS, PRIMARY, SEED, estimate  # noqa: E402

CLEAN_SINCE = date(2026, 10, 31)
ENOUGH_DAYS = 14
QUERY = "select type, symbol, fired_at, direction, ret_5m, ret_15m, ret_1h from signal"
RETURNS = {5: "ret_5m", 15: "ret_15m", 60: "ret_1h"}


def from_docker(container: str) -> pd.DataFrame:
    out = subprocess.run(
        ["docker", "exec", container, "psql", "-U", "pulse", "-d", "pulse", "-c",
         f"\\copy ({QUERY}) to stdout with csv header"],
        check=True, capture_output=True, text=True).stdout
    return pd.read_csv(io.StringIO(out))


def prepare(raw: pd.DataFrame, since: date, until: date | None = None) -> pd.DataFrame:
    """The live rows in the shape signals.py measures: type in lower case, day, m5/m15/m60 signed."""
    frame = raw.copy()
    frame["type"] = frame["type"].str.lower()
    frame = frame[frame["type"].isin(LABELS.keys())]
    fired = pd.to_datetime(frame["fired_at"], utc=True, format="ISO8601")
    frame["day"] = fired.dt.date
    frame = frame[frame["day"] >= since]
    if until is not None:
        frame = frame[frame["day"] <= until]
    frame = frame.rename(columns={"direction": "dir"})
    for horizon, column in RETURNS.items():
        # stored as the plain price change in percent; the study counts it in the signal's direction
        frame[f"m{horizon}"] = frame["dir"] * frame[column]
    return frame.reset_index(drop=True)


def table(frame: pd.DataFrame, days: list[date], rng: np.random.Generator) -> list[str]:
    lines = ["| Сигнал | n | Через 5 мин | Через 15 мин | Через 60 мин | Доля «в свою сторону», 60 мин |",
             "|---|---:|---:|---:|---:|---:|"]
    for kind in LABELS:
        part = frame[(frame["type"] == kind) & (frame["dir"] != 0)]
        cells = [estimate(part, f"m{h}", days, rng) for h in HORIZONS]
        share = "–" if cells[-1].n == 0 else f"{cells[-1].share:.0%}"
        lines.append(f"| {LABELS[kind]} | {cells[0].n} | " + " | ".join(c.cell() for c in cells) + f" | {share} |")
    return lines


def verdicts(frame: pd.DataFrame, days: list[date], rng: np.random.Generator) -> list[str]:
    """Plain words for the hour: does the move clear zero, and does it clear the fees."""
    out = []
    for kind in LABELS:
        part = frame[(frame["type"] == kind) & (frame["dir"] != 0)]
        e = estimate(part, f"m{PRIMARY}", days, rng)
        if e.n == 0:
            out.append(f"{LABELS[kind]}: сигналов с исходом нет.")
        elif e.lo > 0:
            pays = "и больше комиссии" if e.lo > FEES else f"но не надёжно больше комиссии ~{FEES:.2f}%"
            out.append(f"{LABELS[kind]}: через час цена шла в сторону сигнала ({e.mean:+.2f}%), {pays}.")
        elif e.hi < 0:
            out.append(f"{LABELS[kind]}: через час цена шла против сигнала ({e.mean:+.2f}%): скорее откат.")
        else:
            out.append(f"{LABELS[kind]}: через час ход неотличим от нуля ({e.mean:+.2f}%, интервал накрывает 0).")
    return out


def report(frame: pd.DataFrame, since: date, until: date) -> str:
    rng = np.random.default_rng(SEED)
    days = list(pd.date_range(since, until, freq="D").date)
    counts = frame.groupby("type").size()
    measured = frame[f"m{PRIMARY}"].notna().sum()
    lines = [
        f"Живая статистика Pulse, {since} — {until} ({len(days)} дн.). Сигналов: {len(frame)} "
        f"(PUMP {counts.get('pump', 0)}, DUMP {counts.get('dump', 0)}, VOLUME {counts.get('volume', 0)}), "
        f"с исходом через час: {measured}.",
        "",
        "Клетка — средний ход цены **в сторону сигнала** в процентах и 95% интервал бутстрэпом по дням, как в "
        f"signals-2026-10.md. Комиссия не вычтена: круг стоит около {FEES:.2f}%.",
        "",
        *table(frame, days, rng),
        "",
        *[f"- {v}" for v in verdicts(frame, days, rng)],
    ]
    if len(days) < ENOUGH_DAYS:
        lines += ["", f"Внимание: дней меньше {ENOUGH_DAYS}, интервалы широкие и выводы рано делать."]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--docker", metavar="CONTAINER", help="read from this Postgres container, e.g. pulse-postgres-1")
    source.add_argument("--csv", type=Path, help="read an export of the signal table")
    parser.add_argument("--since", type=date.fromisoformat, default=CLEAN_SINCE)
    parser.add_argument("--until", type=date.fromisoformat, help="last day to count (default: yesterday, UTC)")
    args = parser.parse_args()

    raw = from_docker(args.docker) if args.docker else pd.read_csv(args.csv)
    # today is not over: its last signals have no hour behind them yet
    until = args.until or (datetime.now(timezone.utc).date() - timedelta(days=1))
    print(report(prepare(raw, args.since, until), args.since, until))


if __name__ == "__main__":
    main()
