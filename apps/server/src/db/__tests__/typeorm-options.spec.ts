import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as path from 'path';

type TypeOrmOptionsModule = typeof import('../typeorm-options');

// checkIsPostgres locks the driver in module state at the first call, so every
// scenario loads a fresh copy of the module (entities included)
const loadFreshOptions = (): TypeOrmOptionsModule => {
  let mod: TypeOrmOptionsModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../typeorm-options') as TypeOrmOptionsModule;
  });
  return mod!;
};

describe('buildTypeOrmOptions (issue #181)', () => {
  const prevDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (prevDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = prevDatabaseUrl;
    }
  });

  describe('with DATABASE_URL (Postgres)', () => {
    it('never synchronizes and runs migrations on start instead', () => {
      process.env.DATABASE_URL = 'postgres://db';
      const { buildTypeOrmOptions } = loadFreshOptions();

      const options = buildTypeOrmOptions();

      expect(options.type).toBe('postgres');
      expect(options.synchronize).toBe(false);
      expect(options.migrationsRun).toBe(true);
      expect(options.migrations).not.toHaveLength(0);
    });

    it('applies the pg driver pool defaults (issue #333)', () => {
      process.env.DATABASE_URL = 'postgres://db';
      const { buildTypeOrmOptions } = loadFreshOptions();

      const options = buildTypeOrmOptions() as { extra?: { max: number; idleTimeoutMillis: number } };

      expect(options.extra).toEqual({ max: 10, idleTimeoutMillis: 10_000 });
    });

    it('sizes the pool from DB_POOL_SIZE / DB_POOL_IDLE_TIMEOUT (issue #333)', () => {
      process.env.DATABASE_URL = 'postgres://db';
      const prevSize = process.env.DB_POOL_SIZE;
      const prevIdle = process.env.DB_POOL_IDLE_TIMEOUT;
      process.env.DB_POOL_SIZE = '25';
      process.env.DB_POOL_IDLE_TIMEOUT = '0';
      try {
        const { buildTypeOrmOptions } = loadFreshOptions();

        const options = buildTypeOrmOptions() as { extra?: { max: number; idleTimeoutMillis: number } };

        expect(options.extra).toEqual({ max: 25, idleTimeoutMillis: 0 });
      } finally {
        if (prevSize === undefined) delete process.env.DB_POOL_SIZE;
        else process.env.DB_POOL_SIZE = prevSize;
        if (prevIdle === undefined) delete process.env.DB_POOL_IDLE_TIMEOUT;
        else process.env.DB_POOL_IDLE_TIMEOUT = prevIdle;
      }
    });

    it('opens the connection on the active dataset: its schema first in the search_path (issue #527)', () => {
      process.env.DATABASE_URL = 'postgres://db';
      const { buildTypeOrmOptions } = loadFreshOptions();

      const options = buildTypeOrmOptions('ds_wiktionary_en') as { extra?: Record<string, unknown> };

      expect(options.extra).toEqual({
        max: 10,
        idleTimeoutMillis: 10_000,
        options: '-c search_path=ds_wiktionary_en,public',
      });
      // …and leaves the migrations to the start: their journal is in `public`
      expect((buildTypeOrmOptions('ds_wiktionary_en') as { migrationsRun?: boolean }).migrationsRun).toBe(
        false,
      );
      // the default dataset lives in `public`: nothing is added
      expect((buildTypeOrmOptions('public') as { extra?: Record<string, unknown> }).extra).toEqual({
        max: 10,
        idleTimeoutMillis: 10_000,
      });
    });

    it('stays on migrations even in development mode', () => {
      process.env.DATABASE_URL = 'postgres://db';
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const { buildTypeOrmOptions } = loadFreshOptions();

        const options = buildTypeOrmOptions();

        expect(options.synchronize).toBe(false);
        expect(options.migrationsRun).toBe(true);
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
      }
    });
  });

  describe('without DATABASE_URL (SQLite dev fallback)', () => {
    it('synchronizes the dev database and does not attach migrations', () => {
      const { buildTypeOrmOptions } = loadFreshOptions();

      const options = buildTypeOrmOptions();

      expect(options.type).toBe('better-sqlite3');
      expect(options.synchronize).toBe(true);
      expect(options.migrationsRun).toBeUndefined();
      expect(options.migrations).toBeUndefined();
      // better-sqlite3 has no pool; the DB_POOL_* knobs are Postgres-only
      expect((options as { extra?: unknown }).extra).toBeUndefined();
    });

    it('points at dev.sqlite in the repo root', () => {
      const { buildTypeOrmOptions } = loadFreshOptions();

      const options = buildTypeOrmOptions() as { database?: string };

      expect(options.database).toBe(path.join(process.cwd(), '..', '..', 'dev.sqlite'));
    });
  });

  describe('with an explicit sqlite: DATABASE_URL (issue #217)', () => {
    it('uses the given file path resolved against the cwd and keeps synchronize on', () => {
      process.env.DATABASE_URL = 'sqlite:./tmp/e2e.sqlite';
      const { buildTypeOrmOptions } = loadFreshOptions();

      const options = buildTypeOrmOptions() as { type?: string; database?: string; synchronize?: boolean };

      expect(options.type).toBe('better-sqlite3');
      expect(options.database).toBe(path.resolve('./tmp/e2e.sqlite'));
      expect(options.synchronize).toBe(true);
    });

    it('keeps an absolute path as is', () => {
      process.env.DATABASE_URL = 'sqlite:/tmp/e2e.sqlite';
      const { buildTypeOrmOptions } = loadFreshOptions();

      expect((buildTypeOrmOptions() as { database?: string }).database).toBe('/tmp/e2e.sqlite');
    });

    it('passes :memory: through without path resolution', () => {
      process.env.DATABASE_URL = 'sqlite::memory:';
      const { buildTypeOrmOptions } = loadFreshOptions();

      expect((buildTypeOrmOptions() as { database?: string }).database).toBe(':memory:');
    });
  });

  it('registers every entity in both modes', () => {
    const { buildTypeOrmOptions, DB_ENTITIES } = loadFreshOptions();

    expect(DB_ENTITIES.length).toBeGreaterThanOrEqual(6);
    expect(buildTypeOrmOptions().entities).toBe(DB_ENTITIES);
  });
});
