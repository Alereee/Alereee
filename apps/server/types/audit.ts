import { ErrorResT } from './errors';
import { PaginatedListT } from './dictionaries/en/EnApiTypes';

// ------------------------------------------------------------- audit (#334)

/** What caused the change: an admin request, or a dictionary import run */
export enum AuditTriggerE {
  admin = 'admin',
  import = 'import',
}

export enum AuditActionE {
  create = 'create',
  update = 'update',
  delete = 'delete',
  import = 'import',
}

export enum AuditEntityTypeE {
  word = 'word',
  word_form = 'word_form',
  meaning = 'meaning',
  meaning_translation = 'meaning_translation',
  short_translation = 'short_translation',
  setting = 'setting',
  dictionary = 'dictionary',
  suggestion = 'suggestion',
  // a dataset created, activated, edited or deleted (issue #527)
  dataset = 'dataset',
}

/** Only the fields that changed: `{ field: { before, after } }` */
export type AuditDiffT = Record<string, { before: unknown; after: unknown }>;

export type AuditEntryT = {
  id: number;
  /** ISO 8601 */
  created_at: string;
  trigger: AuditTriggerE;
  action: AuditActionE;
  entity_type: AuditEntityTypeE;
  entity_id: number | null;
  /** The headword the change belongs to, when there is one */
  headword: string | null;
  diff: AuditDiffT | null;
  /** The x-request-id of the admin request, to find its log lines (issue #280) */
  request_id: string | null;
  /** The dataset that was active when the change was made (issue #527); null on rows older than the datasets */
  dataset: string | null;
};

/** Query of GET /api/en/audit (mirrors ListAuditQueryDTO) */
export type ListAuditQueryT = {
  page?: number;
  limit?: number;
  entity_type?: AuditEntityTypeE[];
  action?: AuditActionE[];
  trigger?: AuditTriggerE[];
  search?: string;
  from?: string;
  to?: string;
};

export type AuditListT = PaginatedListT<AuditEntryT>;
export type ListAuditResT = AuditListT | ErrorResT;
