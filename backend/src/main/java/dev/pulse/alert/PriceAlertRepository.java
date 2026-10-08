package dev.pulse.alert;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

interface PriceAlertRepository extends JpaRepository<PriceAlertEntity, Long> {

    List<PriceAlertEntity> findByFiredAtIsNull();

    List<PriceAlertEntity> findByUserIdAndFiredAtIsNullOrderBySymbolAscLevelDesc(long userId);

    Optional<PriceAlertEntity> findByIdAndUserIdAndFiredAtIsNull(long id, long userId);

    List<PriceAlertEntity> findByUserIdAndSymbolAndFiredAtIsNull(long userId, String symbol);

    long countByUserIdAndFiredAtIsNull(long userId);
}
