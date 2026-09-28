import { config } from 'dotenv';
import path from 'path';
import { parseDatabaseUrl, resolveEnvFile } from '../configuration';
// The env must be loaded before any entity import: column types are resolved
// inside entity decorators at import time (see checkIsPostgres). ENV_FILE
// names the file explicitly (a build deployed outside the repository tree);
// the default is the repository root, resolved from dist/src
const envFile = resolveEnvFile(path.resolve(__dirname, '../../../../.env'));
// quiet: dotenv 17 otherwise prints a tip of its own on stdout, between the JSON log lines
const dotenvResult = config({ path: envFile.path, quiet: true });
// The scheme of DATABASE_URL is read inside the entity decorators the imports
// below run: an unsupported one would surface as an uncaught throw with a stack
// trace instead of the one-line configuration error every other variable gets
try {
  parseDatabaseUrl(process.env.DATABASE_URL);
} catch (error) {
  console.error(`[Bootstrap] ${(error as Error).message}`);
  process.exit(1);
}
import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './modules/AppModule/app.module';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';
import { buildAdminDocument } from './openapi/build-openapi';
import { PublicOpenApiService } from './modules/PublicApiModule/public-openapi.service';
import { createNestLogger, getLoggerParams } from './core/logging/logger';
import { getLogFormat, getLogLevel } from './core/logging/logging.config';
import { getCorsOrigins, getTrustProxy, isSwaggerEnabled, shouldCompress } from './core/utils/http-hardening';
import { getMetricsPath, isMetricsEnabled } from './modules/MetricsModule/metrics.config';
import { HEALTH_PATH, READY_PATH } from './modules/HealthModule/health.controller';
import { getShutdownTimeout } from './core/utils/shutdown';
import { getDbPoolConfig } from './core/utils/db-pool';
import { parseSuggestionsRateLimit } from './modules/SuggestionsModule/constants';
import { isAutoImportEnabled } from './modules/EnModule/modules/EnImportDictionary/dictionaryBootstrap.service';
import {
  assertPublicApiConfig,
  getApiSurfaces,
  getPublicApiCacheMaxAge,
  getPublicApiRateLimit,
  PUBLIC_API_PREFIX,
} from './core/utils/public-api';
import { assertUpdateCheckConfig, isUpdateCheckEnabled } from './core/utils/update-check';
import {
  assertDatabaseDriverConsistent,
  assertRequiredConfig,
  checkIsPostgres,
  ConfigurationError,
} from '../configuration';

async function bootstrap() {
  // Every line, the bootstrap ones included, goes through pino (issue #280):
  // JSON for a log collector, pino-pretty in a terminal (LOG_FORMAT)
  try {
    Logger.overrideLogger(createNestLogger(getLoggerParams()));
  } catch (error) {
    if (error instanceof ConfigurationError) {
      new Logger('Bootstrap').error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const logger = new Logger('Bootstrap');

  if (dotenvResult.error && envFile.explicit) {
    // an explicitly named file that is missing is a deployment mistake, not a
    // "variables come from the environment" setup: fail before hashing
    // whatever the environment happens to hold
    logger.error(`ENV_FILE=${envFile.path} could not be read: ${dotenvResult.error.message}`);
    process.exit(1);
  }
  if (dotenvResult.error) {
    logger.warn(`Root .env not loaded from ${envFile.path} — relying on the process environment`);
  } else {
    logger.log(`Environment loaded from ${envFile.path}${envFile.explicit ? ' (ENV_FILE)' : ''}`);
  }
  try {
    assertRequiredConfig();
    assertPublicApiConfig();
    assertUpdateCheckConfig();
    assertDatabaseDriverConsistent();
    getShutdownTimeout();
    // Fails here, before Nest is created, instead of inside buildTypeOrmOptions
    getDbPoolConfig();
    parseSuggestionsRateLimit(process.env.SUGGESTIONS_RATE_LIMIT);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create(AppModule);
  // Behind a reverse proxy the client address comes from X-Forwarded-For;
  // TRUST_PROXY says which hops may set it (docs/deployment/reverse-proxy.md)
  const trustProxy = getTrustProxy();
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  const httpServer = app.getHttpServer();
  // The batched dictionary import finishes in minutes and streams progress
  // continuously, so the long-request budget no longer needs 20-minute timeouts
  httpServer.requestTimeout = 5 * 60 * 1000;
  httpServer.headersTimeout = 5 * 60 * 1000 + 1000; // должен быть чуть больше keepAliveTimeout
  httpServer.keepAliveTimeout = 5 * 60 * 1000;

  // Swagger UI relies on an inline bootstrap script, so script-src additionally
  // allows inline scripts while it is served; production keeps the full defaults
  app.use(
    helmet(
      isSwaggerEnabled()
        ? {
            contentSecurityPolicy: {
              directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'script-src': ["'self'", "'unsafe-inline'"],
              },
            },
          }
        : {},
    ),
  );
  app.use(compression({ filter: shouldCompress }));

  if (isSwaggerEnabled()) {
    SwaggerModule.setup('api', app, buildAdminDocument(app));
  }
  // GET /api/v1/openapi.json answers in every environment, Swagger UI or not
  app.get(PublicOpenApiService).attach(app);

  const corsOrigins = getCorsOrigins();
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // удаляет лишние поля
      forbidNonWhitelisted: true, // ошибка если пришли лишние поля
      transform: true, // автопреобразование типов
    }),
  );
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));
  // SIGTERM / SIGINT (process manager, container stop) close the app in
  // order: readiness turns 503, the listener closes, requests in flight
  // finish, the database pool closes; ShutdownWatchdog bounds the wait
  app.enableShutdownHooks();

  const port = process.env.SERVER_PORT || 3010;
  await app.listen(port);

  const isPostgres = checkIsPostgres();
  const { sqlitePath } = parseDatabaseUrl(process.env.DATABASE_URL);
  logger.log(`Server listening on port ${port}`);
  logger.log(
    `Logs: ${getLogFormat()} at level ${getLogLevel()} (LOG_FORMAT, LOG_LEVEL); one line per request with its x-request-id, probes and metrics excluded`,
  );
  logger.log(
    `Probes: liveness at ${HEALTH_PATH}, readiness at ${READY_PATH}; graceful shutdown on SIGTERM, up to ${getShutdownTimeout()} s (SHUTDOWN_TIMEOUT)`,
  );
  logger.log(
    isAutoImportEnabled()
      ? 'Dictionary auto-import: enabled — an empty dictionary is loaded on first start (DICTIONARY_AUTO_IMPORT)'
      : 'Dictionary auto-import: disabled (DICTIONARY_AUTO_IMPORT) — load the dictionary from the admin UI',
  );
  logger.log(
    `Database: ${
      isPostgres
        ? 'Postgres (DATABASE_URL), schema managed by migrations (migrationsRun on start)'
        : `better-sqlite3 (${sqlitePath ?? 'dev.sqlite fallback'}), synchronize=true`
    }`,
  );
  if (isPostgres) {
    const pool = getDbPoolConfig();
    logger.log(
      `Database pool: up to ${pool.max} connections (DB_POOL_SIZE), ` +
        (pool.idleTimeoutSeconds === 0
          ? 'idle connections kept open (DB_POOL_IDLE_TIMEOUT)'
          : `idle connections closed after ${pool.idleTimeoutSeconds} s (DB_POOL_IDLE_TIMEOUT)`),
    );
  }
  logger.log(`CORS origins: ${corsOrigins.join(', ')}`);
  logger.log(
    trustProxy === false
      ? 'Trust proxy: off — X-Forwarded-* headers are ignored (set TRUST_PROXY behind a reverse proxy)'
      : `Trust proxy: ${String(trustProxy)} — client addresses are read from X-Forwarded-For`,
  );
  logger.log(
    `Swagger UI: ${isSwaggerEnabled() ? 'enabled at /api' : 'disabled (production)'}; public OpenAPI document at ${PUBLIC_API_PREFIX}/openapi.json`,
  );
  logger.log(
    isUpdateCheckEnabled()
      ? 'Update check: on — the admin UI is told about a newer release and about newer files of the installed datasets (asks api.github.com and the sources of those datasets; UPDATE_CHECK=false turns it off)'
      : 'Update check: off (UPDATE_CHECK=false) — no outgoing request',
  );
  logger.log(
    isMetricsEnabled()
      ? `Prometheus metrics: enabled at ${getMetricsPath()} — keep it off the public internet (docs/observability.md)`
      : 'Prometheus metrics: disabled (METRICS_ENABLED=false)',
  );
  const surfaces = getApiSurfaces();
  const rateLimit = getPublicApiRateLimit();
  logger.log(
    `Public API ${PUBLIC_API_PREFIX}: ${surfaces.publicApi ? `enabled, ${rateLimit.limit} requests per ${rateLimit.ttl / 1000} s per client, Cache-Control max-age=${getPublicApiCacheMaxAge()} s` : 'disabled (PUBLIC_API_ENABLED=false)'}; ` +
      `admin API: ${surfaces.adminApi ? 'enabled' : 'disabled (ADMIN_API_ENABLED=false)'}`,
  );
}
bootstrap().catch((error: unknown) => {
  // a failure past the guarded config block (a migration error, EADDRINUSE)
  // used to die as a raw unhandled rejection instead of a log line
  new Logger('Bootstrap').fatal(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
