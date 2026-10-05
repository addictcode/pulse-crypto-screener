package dev.pulse.account;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

interface WatchlistItemRepository extends JpaRepository<WatchlistItem, Long> {

    List<WatchlistItem> findByUserIdOrderBySymbol(long userId);

    boolean existsByUserIdAndSymbol(long userId, String symbol);

    long deleteByUserIdAndSymbol(long userId, String symbol);
}
