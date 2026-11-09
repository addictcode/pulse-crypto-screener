"""
The archive study (signals.py) again, on the signals the live Pulse fired and stored: what the price
did 5, 15 and 60 minutes after each PUMP, DUMP and VOLUME signal, in the signal's direction, with
the same bootstrap over days. Run it after two or three weeks of clean data:

    python3 research/live.py --docker pulse-postgres-1          # read the stack's database
    python3 research/live.py --csv signals.csv [--uptime-csv uptime.csv]   # or exports made by hand

The export by hand, for a database that is not a local container:

    psql -U pulse -d pulse -c "\\copy (select type, symbol, fired_at, direction, ret_5m, ret_15m, ret_1h
        from signal) to stdout with csv header" > signals.csv

With the uptime table (the backend keeps it since 9.11.2026), days Pulse did not run are not
counted and signals whose hour crosses a stop are left out.

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
UPTIME_QUERY = "select started_at, last_seen_at from uptime"
# heartbeats further apart than this are a stop (UptimeLog.GAP in the backend)
GAP = timedelta(minutes=5)
RETURNS = {5: "ret_5m", 15: "ret_15m", 60: "ret_1h"}


def from_docker(container: str, query: str = QUERY) -> pd.DataFrame:
    out = subprocess.run(
        ["docker", "exec", container, "psql", "-U", "pulse", "-d", "pulse", "-c",
         f"\\copy ({query}) to stdout with csv header"],
        check=True, capture_output=True, text=True).stdout
    return pd.read_csv(io.StringIO(out))


def downtime(uptime: pd.DataFrame) -> list[tuple[datetime, datetime]]:
    """The stops between the runs of the uptime table, longer than GAP, oldest first."""
    runs = sorted(zip(pd.to_datetime(uptime["started_at"], utc=True, format="ISO8601"),
                      pd.to_datetime(uptime["last_seen_at"], utc=True, format="ISO8601")))
    gaps, end = [], None
    for start, last in runs:
        if end is not None and start - end > GAP:
            gaps.append((end.to_pydatetime(), start.to_pydatetime()))
        end = last if end is None or last > end else end
    return gaps


def apply_uptime(frame: pd.DataFrame, uptime: pd.DataFrame, since: date, until: date) -> tuple[pd.DataFrame, list[date], int]:
    """
    Leaves out signals whose hour crosses a stop (the price after it was not watched the whole time)
    and the days Pulse did not run at all: a week with three dead days is four days of data, and the
    bootstrap over days must not resample empty ones. Returns the rows, the days and how many left.
    """
    gaps = downtime(uptime)
    runs = list(zip(pd.to_datetime(uptime["started_at"], utc=True, format="ISO8601").dt.to_pydatetime(),
                    pd.to_datetime(uptime["last_seen_at"], utc=True, format="ISO8601").dt.to_pydatetime()))
    fired = pd.to_datetime(frame["fired_at"], utc=True, format="ISO8601")
    hour_end = fired + pd.Timedelta(minutes=PRIMARY)
    crosses = pd.Series(False, index=frame.index)
    for start, end in gaps:
        crosses |= (fired < end) & (hour_end > start)
    days = []
    for day in pd.date_range(since, until, freq="D").date:
        day_start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        day_end = day_start + timedelta(days=1)
        # a day counts if Pulse ran at some point of it: not before its first run, not inside a stop
        if any(start < day_end and last > day_start for start, last in runs):
            days.append(day)
    return frame[~crosses].reset_index(drop=True), days, int(crosses.sum())


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


def report(frame: pd.DataFrame, since: date, until: date, days: list[date] | None = None, dropped: int = 0) -> str:
    """days: the days Pulse ran (apply_uptime); all days of the period without an uptime table."""
    rng = np.random.default_rng(SEED)
    period = list(pd.date_range(since, until, freq="D").date)
    days = period if days is None else days
    counts = frame.groupby("type").size()
    measured = frame[f"m{PRIMARY}"].notna().sum()
    lines = [
        f"Живая статистика Pulse, {since} — {until} ({len(days)} дн.). Сигналов: {len(frame)} "
        f"(PUMP {counts.get('pump', 0)}, DUMP {counts.get('dump', 0)}, VOLUME {counts.get('volume', 0)}), "
        f"с исходом через час: {measured}.",
        *([f"Pulse работал {len(days)} дн. из {len(period)}; дни простоя не считаются, а {dropped} сигн., чей час "
           "пересёк простой, исключены."] if len(days) != len(period) or dropped else []),
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
    parser.add_argument("--uptime-csv", type=Path, help="with --csv: an export of the uptime table (started_at, last_seen_at)")
    parser.add_argument("--since", type=date.fromisoformat, default=CLEAN_SINCE)
    parser.add_argument("--until", type=date.fromisoformat, help="last day to count (default: yesterday, UTC)")
    args = parser.parse_args()

    raw = from_docker(args.docker) if args.docker else pd.read_csv(args.csv)
    # today is not over: its last signals have no hour behind them yet
    until = args.until or (datetime.now(timezone.utc).date() - timedelta(days=1))
    frame = prepare(raw, args.since, until)
    uptime = from_docker(args.docker, UPTIME_QUERY) if args.docker else (pd.read_csv(args.uptime_csv) if args.uptime_csv else None)
    if uptime is None or uptime.empty:
        print(report(frame, args.since, until))
    else:
        frame, days, dropped = apply_uptime(frame, uptime, args.since, until)
        print(report(frame, args.since, until, days, dropped))


if __name__ == "__main__":
    main()
