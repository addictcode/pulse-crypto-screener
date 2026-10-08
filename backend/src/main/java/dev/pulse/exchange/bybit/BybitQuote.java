package dev.pulse.exchange.bybit;

/**
 * One Bybit USDT perpetual as its ticker reports it.
 *
 * @param funding      current funding rate in percent per {@code fundingHours}
 * @param fundingHours how often funding is paid on this contract: 8, 4, 2 or 1
 * @param oi           open interest in USD
 * @param vol24h       traded value over 24 hours in USD
 */
public record BybitQuote(String symbol, double price, Double funding, int fundingHours, Double oi, double vol24h) {
}
