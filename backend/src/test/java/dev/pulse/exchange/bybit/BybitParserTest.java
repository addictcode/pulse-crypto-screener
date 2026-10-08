package dev.pulse.exchange.bybit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

class BybitParserTest {

    private final JsonMapper mapper = JsonMapper.builder().build();

    @Test
    void keepsUsdtPerpetualsAndReadsStringNumbers() {
        List<BybitQuote> quotes = BybitParser.tickers(mapper.readTree("""
                {"retCode":0,"retMsg":"OK","result":{"category":"linear","list":[
                  {"symbol":"BTCUSDT","lastPrice":"83122.20","openInterestValue":"4834295131.15","turnover24h":"4258936071.0153",
                   "fundingRate":"0.00000724","fundingIntervalHour":"8"},
                  {"symbol":"WIFUSDT","lastPrice":"0.8421","openInterestValue":"","turnover24h":"1200000","fundingRate":"-0.0005","fundingIntervalHour":"4"},
                  {"symbol":"BTCPERP","lastPrice":"83100","fundingRate":"0.0001","fundingIntervalHour":"8"},
                  {"symbol":"BTCUSDT-26DEC26","lastPrice":"85000","fundingRate":"","fundingIntervalHour":""},
                  {"symbol":"NEWUSDT","lastPrice":"","fundingRate":"","fundingIntervalHour":""}
                ]}}
                """));

        assertThat(quotes).extracting(BybitQuote::symbol).containsExactly("BTCUSDT", "WIFUSDT");
        BybitQuote btc = quotes.getFirst();
        assertThat(btc.price()).isEqualTo(83122.20);
        assertThat(btc.funding()).isCloseTo(0.000724, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(btc.oi()).isEqualTo(4834295131.15);
        BybitQuote wif = quotes.get(1);
        assertThat(wif.fundingHours()).isEqualTo(4);
        assertThat(wif.funding()).isEqualTo(-0.05);
        assertThat(wif.oi()).isNull();
    }

    @Test
    void anErrorReplyIsNotAnEmptyMarket() {
        assertThatThrownBy(() -> BybitParser.tickers(mapper.readTree("{\"retCode\":10006,\"retMsg\":\"Too many visits!\"}")))
                .hasMessageContaining("Too many visits");
    }
}
