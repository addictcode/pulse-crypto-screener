package dev.pulse.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.telegram.TelegramLinks;
import lombok.RequiredArgsConstructor;

/** Where the Telegram buttons on the site lead; empty fields hide them. */
@RestController
@RequiredArgsConstructor
public class LinksController {

    private final TelegramLinks telegram;

    @GetMapping("/api/links")
    public TelegramLinks.Links links() {
        return telegram.links();
    }
}
