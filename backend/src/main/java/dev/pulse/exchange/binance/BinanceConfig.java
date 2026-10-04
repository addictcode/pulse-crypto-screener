package dev.pulse.exchange.binance;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

import dev.pulse.config.PulseProperties;
import tools.jackson.databind.json.JsonMapper;

/**
 * One parser and one REST client shared by the market adapter and the depth feed, so both draw
 * from the same request-weight budget.
 */
@Configuration
@ConditionalOnProperty(prefix = "pulse.binance", name = "enabled", havingValue = "true", matchIfMissing = true)
class BinanceConfig {

    @Bean
    BinanceParser binanceParser(JsonMapper mapper) {
        return new BinanceParser(mapper);
    }

    @Bean
    BinanceRestClient binanceRestClient(RestClient.Builder builder, BinanceParser parser, PulseProperties properties) {
        PulseProperties.Binance config = properties.binance();
        return new BinanceRestClient(builder.baseUrl(config.restUrl()).build(), parser,
                config.restRequestsPerSecond(), config.depthSnapshotsPerSecond(), config.weightLimit());
    }
}
