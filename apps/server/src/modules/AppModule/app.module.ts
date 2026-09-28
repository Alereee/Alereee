import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from '../../../configuration';
import { AuthModule } from '../AuthModule/auth.module';
import { EnModule } from '../EnModule/en.module';
import { SettingsModule } from '../SettingsModule/settings.module';
import { PublicApiModule } from '../PublicApiModule/public-api.module';
import { SuggestionsModule } from '../SuggestionsModule/suggestions.module';
import { apiSurfaceMiddleware } from '../../core/middleware/api-surface.middleware';
import { typeOrmRoot } from '../../db/typeorm-root';
import { DatasetsModule } from '../DatasetsModule/datasets.module';
import { DatasetsService } from '../DatasetsModule/datasets.service';
import { switchGateMiddleware } from '../DatasetsModule/switch-gate';
import { HealthModule } from '../HealthModule/health.module';
import { ImportStatusModule } from '../EnModule/modules/EnImportDictionary/importStatus.module';
import { MetricsModule } from '../MetricsModule/metrics.module';
import { MetricsService } from '../MetricsModule/metrics.service';
import { httpMetricsMiddleware, metricsEndpoint } from '../MetricsModule/metrics.middleware';
import { getMetricsPath, isMetricsEnabled } from '../MetricsModule/metrics.config';
import { getLoggerParams } from '../../core/logging/logger';

@Module({
  imports: [
    // pino behind every Logger and one line per request (issue #280); the
    // factory reads LOG_LEVEL / LOG_FORMAT once the environment is loaded
    LoggerModule.forRootAsync({ useFactory: getLoggerParams }),
    AuthModule,
    EnModule,
    SettingsModule,
    PublicApiModule,
    // reader feedback on the dictionary data (issue #327)
    SuggestionsModule,
    MetricsModule,
    // the import slot and its status, read by HealthModule and written by EnModule (issue #268)
    ImportStatusModule,
    HealthModule,
    // Default limits; endpoints refine them through @Throttle. The guard
    // (AppThrottlerGuard) is attached to login, the legacy search aliases and
    // the whole public prefix (PUBLIC_API_RATE_LIMIT).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    // the migrations of `public` and of every dataset schema run first, and
    // answer the schema of the active dataset (issue #527)
    TypeOrmModule.forRootAsync(typeOrmRoot),
    DatasetsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
  ],
})
export class AppModule implements NestModule {
  constructor(
    private readonly metrics: MetricsService,
    private readonly datasets: DatasetsService,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    if (isMetricsEnabled()) {
      // Prometheus (issue #281): every request is timed before routing so
      // 404s count too, and the exposition is served outside both API surfaces
      const path = getMetricsPath();
      consumer.apply(httpMetricsMiddleware(this.metrics, path)).forRoutes('*');
      consumer.apply(metricsEndpoint(this.metrics)).forRoutes(path);
    }
    // version header on the public prefix and the PUBLIC_API_ENABLED /
    // ADMIN_API_ENABLED switches; runs before routing so 404s are covered too
    consumer.apply(apiSurfaceMiddleware).forRoutes('*');
    // a switch of the active dataset re-opens the database connection: the
    // requests wait for it and it waits for them (issue #527)
    consumer.apply(switchGateMiddleware(this.datasets.gate)).forRoutes('*');
  }
}
