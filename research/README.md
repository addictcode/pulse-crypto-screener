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
- `live.py` — то же исследование на сигналах, которые живой Pulse записал в базу (пункт «через
  2–3 недели чистых данных» из CLAUDE.md): ход цены через 5, 15 и 60 минут в сторону сигнала,
  тот же бутстрэп по дням, вердикт по часу. Считает только с 31.10.2026 (раньше — склейка кадров).

  ```bash
  python3 research/live.py --docker pulse-postgres-1   # на маке или на сервере, где стек
  python3 research/live.py --csv signals.csv           # экспорт таблицы signal, команда — в live.py
  ```

  Печатает таблицу и вывод — их вставить в новый отчёт рядом с `signals-2026-10.md`.
  Тесты: `python3 -m unittest research/test_live.py`.

Нужны Python 3.11+, numpy и pandas.
