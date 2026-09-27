import { SourceAdapterT } from '../types';
import { wiktionary } from './wiktionary';
import { wordnet } from './wordnet';

// The public sources a dataset can be converted from (issue #527). A source
// is one module that reads what the source distributes and emits entries;
// README.md next to the converters says how to add one.
export const SOURCES: readonly SourceAdapterT[] = [wiktionary, wordnet];

export const findSource = (name: string): SourceAdapterT | undefined =>
  SOURCES.find((source) => source.name === name);
