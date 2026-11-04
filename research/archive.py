"""
Binance USDT-M futures 1-minute candles from the public archive (data.binance.vision), cached.

The archive is the only source that works from anywhere: fapi.binance.com answers 451 to US
addresses. Months come as one zip per symbol, the current month day by day, about a day late.
When data.binance.vision itself is not reachable, the same files are read straight from the S3
bucket behind it.
"""
from __future__ import annotations

import calendar
import csv
import http.client
import io
import re
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HOSTS = ("https://data.binance.vision", "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision")
LISTING_ROOT = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
CACHE = Path(__file__).resolve().parent / ".cache"
# perpetuals only: delivery contracts carry a date suffix (BTCUSDT_261226)
PERPETUAL = re.compile(r"^[A-Z0-9]+USDT$")
MINUTE_MS = 60_000


def _get(path: str) -> bytes | None:
    """The file at `path` under the archive root, or None if the archive does not have it."""
    for attempt in range(4):
        for host in HOSTS:
            try:
                with urllib.request.urlopen(f"{host}/{path}", timeout=60) as response:
                    return response.read()
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
            except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError):
                # a cut-off download (IncompleteRead) is as retryable as a refused one
                pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"archive unreachable: {path}")


def _read(url: str) -> str:
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read().decode()
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(2 ** attempt)
    raise RuntimeError(f"archive listing unreachable: {url}")


def _listing(prefix: str) -> list[str]:
    """Names under an archive folder, from the S3 listing, 1000 a page."""
    names: list[str] = []
    marker = ""
    while True:
        url = f"{LISTING_ROOT}?delimiter=/&prefix={prefix}" + (f"&marker={marker}" if marker else "")
        xml = _read(url)
        page = re.findall(rf"<Prefix>{re.escape(prefix)}([^/<]+)/</Prefix>", xml)
        names += page
        if "<IsTruncated>true</IsTruncated>" not in xml or not page:
            break
        marker = f"{prefix}{page[-1]}/"
    return names


def symbols() -> list[str]:
    """Every USDT perpetual the archive has daily candles for."""
    return sorted({n for n in _listing("data/futures/um/daily/klines/") if PERPETUAL.match(n)})


def crypto_symbols() -> list[str]:
    """
    USDT perpetuals on crypto assets. Binance also lists perpetuals on shares, funds and metals
    (XAUUSDT, TSLAUSDT, ...) with another contract type, which Pulse leaves out; the archive does not
    say which is which. A coin with a Binance spot market is crypto, so that is the test. It also
    leaves out coins traded only as futures, mostly young small caps.
    """
    spot = set(_listing("data/spot/daily/klines/"))
    def base(symbol: str) -> str:
        # 1000PEPEUSDT on futures is PEPEUSDT on spot
        return re.sub(r"^1000+", "", symbol)
    return [s for s in symbols() if s in spot or base(s) in spot]


def _zip_rows(data: bytes) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        text = archive.read(archive.namelist()[0]).decode()
    rows = list(csv.reader(io.StringIO(text)))
    # newer files start with a header line, older ones do not
    return [r for r in rows if r and r[0].isdigit()]


def _cached(path: str) -> list[list[str]] | None:
    file = CACHE / path
    if file.exists():
        return _zip_rows(file.read_bytes()) if file.stat().st_size else None
    data = _get(path)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data or b"")  # an empty file remembers "not in the archive"
    return _zip_rows(data) if data else None


def _day_path(symbol: str, day: date) -> str:
    return f"data/futures/um/daily/klines/{symbol}/1m/{symbol}-1m-{day.isoformat()}.zip"


def _month_path(symbol: str, year: int, month: int) -> str:
    return f"data/futures/um/monthly/klines/{symbol}/1m/{symbol}-1m-{year}-{month:02d}.zip"


def day_volume(symbol: str, day: date) -> float:
    """Quote volume of one day, for ranking symbols by liquidity; 0 if the archive lacks the day."""
    rows = _cached(_day_path(symbol, day))
    return sum(float(r[7]) for r in rows) if rows else 0.0


def candles(symbol: str, start: date, end: date) -> dict[str, np.ndarray]:
    """
    One-minute candles from `start` to `end` inclusive on a gapless minute grid. Minutes the
    archive does not have are NaN, so nothing computed across a gap looks real.
    Columns: t (open time, ms), open, high, low, close, qv (quote volume, USDT).
    """
    rows: list[list[str]] = []
    day = start
    while day <= end:
        month_end = (date(day.year + day.month // 12, day.month % 12 + 1, 1)) - timedelta(days=1)
        whole_month = day.day == 1 and month_end <= end
        monthly = _cached(_month_path(symbol, day.year, day.month)) if whole_month else None
        if monthly:
            rows += monthly
            day = month_end + timedelta(days=1)
            continue
        rows += _cached(_day_path(symbol, day)) or []
        day += timedelta(days=1)
    t0 = calendar.timegm(start.timetuple()) * 1000
    t1 = calendar.timegm((end + timedelta(days=1)).timetuple()) * 1000
    n = (t1 - t0) // MINUTE_MS
    grid = {k: np.full(n, np.nan) for k in ("open", "high", "low", "close", "qv")}
    for r in rows:
        i = (int(r[0]) - t0) // MINUTE_MS
        if 0 <= i < n:
            grid["open"][i], grid["high"][i], grid["low"][i], grid["close"][i] = float(r[1]), float(r[2]), float(r[3]), float(r[4])
            grid["qv"][i] = float(r[7])
    grid["t"] = t0 + np.arange(n, dtype=np.int64) * MINUTE_MS
    return grid


def _cached_text(path: str) -> str | None:
    """The CSV inside an archived zip, header and all; None if the archive does not have it."""
    file = CACHE / path
    if file.exists():
        data = file.read_bytes() or None
    else:
        data = _get(path)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data or b"")
    if not data:
        return None
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.read(archive.namelist()[0]).decode()


def open_interest(symbol: str, start: date, end: date) -> tuple[np.ndarray, np.ndarray]:
    """
    Open interest in contracts, a point every 5 minutes, from the daily "metrics" files: (time in
    ms, contracts), sorted by time (the files are not). Days the archive lacks are simply absent.
    """
    times: list[int] = []
    values: list[float] = []
    day = start
    while day <= end:
        text = _cached_text(f"data/futures/um/daily/metrics/{symbol}/{symbol}-metrics-{day.isoformat()}.zip")
        for row in csv.DictReader(io.StringIO(text or "")):
            stamp = datetime.strptime(row["create_time"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            if row["sum_open_interest"]:
                times.append(int(stamp.timestamp() * 1000))
                values.append(float(row["sum_open_interest"]))
        day += timedelta(days=1)
    order = np.argsort(times, kind="stable")
    return np.asarray(times, dtype=np.int64)[order], np.asarray(values)[order]


def funding(symbol: str, start: date, end: date) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Funding settlements from the monthly "fundingRate" files: (time in ms, rate as a fraction, hours
    between settlements). Only settled rates: the live predicted rate between them is not archived.
    """
    times: list[int] = []
    rates: list[float] = []
    hours: list[float] = []
    month = date(start.year, start.month, 1)
    t0 = calendar.timegm(start.timetuple()) * 1000
    t1 = calendar.timegm((end + timedelta(days=1)).timetuple()) * 1000
    while month <= end:
        text = _cached_text(f"data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month.year}-{month.month:02d}.zip")
        for row in csv.DictReader(io.StringIO(text or "")):
            t = int(row["calc_time"])
            if t0 <= t < t1:
                times.append(t)
                rates.append(float(row["last_funding_rate"]))
                hours.append(float(row["funding_interval_hours"]))
        month = date(month.year + month.month // 12, month.month % 12 + 1, 1)
    order = np.argsort(times, kind="stable")
    return np.asarray(times, dtype=np.int64)[order], np.asarray(rates)[order], np.asarray(hours)[order]


def prefetch(symbols_: list[str], start: date, end: date, workers: int = 8) -> None:
    """Downloads everything `candles` will read, in parallel; the archive is slow one file at a time."""
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(lambda s: candles(s, start, end), symbols_))


def rank_by_volume(symbols_: list[str], day: date, workers: int = 16) -> list[tuple[str, float]]:
    with ThreadPoolExecutor(workers) as pool:
        volumes = list(pool.map(lambda s: day_volume(s, day), symbols_))
    return sorted(zip(symbols_, volumes), key=lambda x: -x[1])
