import { describe, expect, it } from '@jest/globals';
import { assertSafeSchema, prepareDatabase, searchPathExtra, searchPathOf } from '../datasets';

// The database side of the datasets (issue #527): what reaches SQL and the
// connection options unquoted, and what SQLite gets

describe('dataset schemas', () => {
  it('puts the dataset first and the shared tables behind it', () => {
    expect(searchPathOf('ds_wiktionary_en')).toBe('ds_wiktionary_en,public');
    expect(searchPathExtra('ds_wiktionary_en')).toEqual({ options: '-c search_path=ds_wiktionary_en,public' });
  });

  it('leaves the connection of the default dataset as it always was', () => {
    expect(searchPathOf('public')).toBe('public');
    expect(searchPathExtra('public')).toEqual({});
  });

  it('refuses a name that could break out of the statement or the options', () => {
    for (const bad of [
      '',
      'ds x',
      'ds-x',
      'Ds_x',
      'ds_x;drop',
      'ds_x,pg_catalog',
      '"ds"',
      '1ds',
      'a'.repeat(64),
    ]) {
      expect(() => assertSafeSchema(bad)).toThrow();
      expect(() => searchPathExtra(bad)).toThrow();
    }
    expect(assertSafeSchema('ds_a1')).toBe('ds_a1');
  });

  it('has nothing to prepare on SQLite: one dataset, built by synchronize', async () => {
    await expect(prepareDatabase()).resolves.toBe('public');
  });
});
