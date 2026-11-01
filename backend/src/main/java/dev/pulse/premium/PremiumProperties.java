package dev.pulse.premium;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Paid premium through Telegram Stars.
 *
 * @param enabled     false (the default): /premium says it is not on sale and no invoice is ever sent
 * @param priceStars  price of one period in Telegram Stars
 * @param days        how long one payment lasts; paying before the end adds to it
 * @param perks       what premium gives, one line each, as /premium shows it. Only words: what a
 *                    perk does is switched on in code by asking {@link PremiumService#active}
 */
@ConfigurationProperties("pulse.premium")
public record PremiumProperties(boolean enabled, int priceStars, int days, String title, String description, List<String> perks) {

    /** What the invoice carries and the payment brings back, to tell our invoices from anything else. */
    public static final String PAYLOAD = "pulse-premium";

    public PremiumProperties {
        perks = perks == null ? List.of() : List.copyOf(perks);
        title = title == null ? "Pulse Premium" : title;
        description = description == null ? "" : description;
    }
}
