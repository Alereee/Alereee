import { ErrorResT } from './errors';

/**
 * The history of the edits of a dataset (issue #531). A dataset of a public
 * source may be edited on an instance, and its license asks that a reader is
 * told: every edit leaves a row with the values it changed, next to the data
 * it is about — in the schema of its dataset — and an entry is "modified"
 * while it has rows that still show in what is served. A dataset is taken to
 * be what its source published until an edit is recorded: the history starts
 * empty, after a migration and after an import of data that carries none.
 */

/** What was edited */
export enum ChangeEntityE {
  word = 'word',
  word_form = 'word_form',
  meaning = 'meaning',
  meaning_translation = 'meaning_translation',
  short_translation = 'short_translation',
}

export enum ChangeActionE {
  create = 'create',
  update = 'update',
  delete = 'delete',
}

/** Where an edit came from */
export enum ChangeOriginE {
  /** Made in the admin UI */
  admin = 'admin',
  /** A correction of a reader, applied by the admin */
  suggestion = 'suggestion',
  /** An earlier change taken back */
  revert = 'revert',
}

/** The values an edit changed: `{ field: { before, after } }`; a creation has no `before`, a deletion no `after` */
export type ChangeDiffT = Record<string, { before: unknown; after: unknown }>;

export type ChangeFormRecordT = { word: string; form_of_word: string };
export type ChangeMeaningRecordT = {
  title: string;
  /** @asType integer */
  sort_order: number;
};
export type ChangeTranslationRecordT = { meaning: ChangeMeaningRecordT; language: string; title: string };
export type ChangeShortTranslationRecordT = { language: string; description: string };
/**
 * The record of an entry an edit is about, by what it says rather than by
 * its id: ids change when a dataset is updated and differ between
 * instances. Null for the word itself — the headword and the part of speech
 * name it.
 */
export type ChangeRecordT =
  ChangeFormRecordT | ChangeMeaningRecordT | ChangeTranslationRecordT | ChangeShortTranslationRecordT;

export type ChangeT = {
  /** @asType integer */
  id: number;
  created_at: string;
  /** The spelling of the entry; an edit of a form names the entry of its base word */
  headword: string;
  /** The article that was edited; null when the edit is about every article of the headword */
  part_of_speech: string | null;
  entity: ChangeEntityE;
  action: ChangeActionE;
  record: ChangeRecordT | null;
  diff: ChangeDiffT;
  origin: ChangeOriginE;
  /** @asType integer */
  suggestion_id: number | null;
  /** Who sent the correction, when they asked to be named */
  author: string | null;
  /** When an update of the dataset replaced the entry with the content of its source, or the change was taken back */
  superseded_at: string | null;
  /** Whether the change can be taken back: it still shows in what is served */
  revertible: boolean;
};

export type ChangeListT = {
  items: ChangeT[];
  /** @asType integer */
  total: number;
  /** @asType integer */
  page: number;
  /** @asType integer */
  limit: number;
  has_more: boolean;
};

// Mirrors ListChangesQueryDTO (the admin listing query)
export type ListChangesQueryT = {
  /** @asType integer */
  page?: number | undefined;
  /** @asType integer */
  limit?: number | undefined;
  /** The headword, exactly */
  headword?: string | undefined;
  /** The article of the headword; the edits about every article of it are listed too */
  part_of_speech?: string | undefined;
  /** Headword prefix, case-insensitive */
  search?: string | undefined;
  /** The beginning of the name of the reader who sent the correction, case-insensitive */
  author?: string | undefined;
  entity?: ChangeEntityE[] | undefined;
  action?: ChangeActionE[] | undefined;
  origin?: ChangeOriginE[] | undefined;
  /** Only the changes that still show in what is served */
  active?: boolean | undefined;
};

// Mirrors ForgetChangeAuthorReqDTO
export type ForgetChangeAuthorReqT = {
  /** The name as it is shown, exactly */
  author: string;
};

export type ListChangesResT = ChangeListT | ErrorResT;
export type RevertChangeResT = { success: true } | ErrorResT;
export type ForgetChangeAuthorResT =
  | {
      success: true;
      /**
       * The rows that named the author, in every dataset of the instance
       * @asType integer
       */
      forgotten: number;
    }
  | ErrorResT;
