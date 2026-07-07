// Глобальные настройки и localStorage-обёртка

export const LS = {
  get(k, d) {
    try { const v = localStorage.getItem('pulse.' + k); return v == null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('pulse.' + k, JSON.stringify(v)); } catch { /* private mode */ }
  },
};

export const MAX_SYMBOLS = 350;      // максимум пар в юниверсе (топ по объёму)
export const KLINE_KEEP = 130;       // сколько 1м-свечей держим на символ (~2 часа)
export const SIGNAL_COOLDOWN = 240e3; // не дублировать сигнал по паре чаще, чем раз в 4 мин

export const PUMP_1M = 1.2;          // % за 1 минуту для сигнала памп/дамп
export const PUMP_5M = 2.5;          // % за 5 минут
export const VOL_SPIKE_X = 5;        // кратность всплеска объёма
export const BIG_LIQ_USD = 250e3;    // крупная ликвидация для сигнала, $
