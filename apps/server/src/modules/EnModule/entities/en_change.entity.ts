import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { checkIsPostgres } from '../../../../configuration';
import { ChangeActionE, ChangeEntityE, ChangeOriginE } from '../../../../types';
import type { ChangeDiffT, ChangeRecordT } from '../../../../types';

const JSON_COLUMN = checkIsPostgres() ? 'jsonb' : 'simple-json';
const TIMESTAMP_COLUMN = checkIsPostgres() ? 'timestamptz' : 'datetime';

/**
 * One edit of the content of a dataset (issue #531): what was changed, with
 * the values before and after. The table lies in the schema of its dataset,
 * like the entries it is about, so the histories of two datasets never
 * meet; it refers to an entry by its spelling and part of speech, because an
 * update of the dataset deletes the rows of a word and inserts new ones.
 * Rows are never deleted: `superseded_at` says that an edit no longer shows
 * in what is served. Unlike the audit journal, this is a part of the data —
 * kept for good and carried by an export.
 */
@Entity('en_changes')
@Index('IDX_EN_CHANGES_HEADWORD', ['headword'])
export class EnChange {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_en_changes' })
  id!: number;

  @CreateDateColumn({ name: 'created_at', type: TIMESTAMP_COLUMN })
  created_at!: Date;

  @Column({ type: 'varchar', length: 128 })
  headword!: string;

  // the values of EnPartOfSpeechE, kept as text: an enum type is shared by
  // every dataset schema and would need a migration of its own in `public`
  @Column({ type: 'varchar', length: 32, nullable: true })
  part_of_speech!: string | null;

  @Column({ type: 'varchar', length: 32 })
  entity!: ChangeEntityE;

  @Column({ type: 'varchar', length: 16 })
  action!: ChangeActionE;

  @Column({ type: JSON_COLUMN, nullable: true })
  record!: ChangeRecordT | null;

  // a row of the history is an edit with its values: there is none without
  @Column({ type: JSON_COLUMN })
  diff!: ChangeDiffT;

  @Column({ type: 'varchar', length: 16 })
  origin!: ChangeOriginE;

  // no foreign key: the history outlives the suggestion it came from
  @Column({ type: 'int', nullable: true })
  suggestion_id!: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  author!: string | null;

  @Column({ type: TIMESTAMP_COLUMN, nullable: true })
  superseded_at!: Date | null;
}
