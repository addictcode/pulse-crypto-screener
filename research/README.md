# research/

Исследования на архивных данных. Только отчёты: правила в коде отсюда не меняются.

- `signals-2026-10.md` — есть ли у сигналов PUMP / DUMP / VOLUME предсказательная сила
  (август — октябрь 2026, 150 пар, проверка на второй половине периода).
- `signals.py` — реплей правил `SignalRules` на минутных свечах и таблицы для отчёта:

  ```bash
  python3 research/signals.py                      # 150 пар, 2026-08-01 .. 2026-10-30
  python3 research/signals.py --pairs 80 --start 2026-09-01 --end 2026-10-30 --save /tmp/signals.csv
  ```

  Перезаписывает в отчёте только блок между `<!-- tables:start -->` и `<!-- tables:end -->`.
- `archive.py` — свечи из `data.binance.vision` (или того же S3-бакета, если сайт недоступен),
  кэш в `research/.cache/` (в `.gitignore`; полный прогон — около 700 МБ и 15–20 минут загрузки).
- `test_signals.py` — правила на синтетических свечах: `python3 -m unittest research/test_signals.py`.

Нужны Python 3.11+, numpy и pandas.
