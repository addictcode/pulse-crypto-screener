package dev.pulse.exchange;

/**
 * @param historyLoaded symbols whose candle history finished loading; metrics such as 1h change
 *                      and NATR stay empty for a symbol until its history is in
 */
public record ExchangeStatus(
        String exchange,
        int symbols,
        int historyLoaded,
        int connections,
        int connectionsOpen,
        Long lastFrameAt) {
}
