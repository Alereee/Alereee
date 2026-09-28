import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IsDate, IsNotEmpty, IsNumber, IsPositive } from 'class-validator';
import { SuggestionEditT, SuggestionKindE, SuggestionStatusE } from '../../../../types';
import { EnWord } from '../../EnModule/entities/en_word.entity';
import { checkIsPostgres } from '../../../../configuration';

/**
 * A reader's report on the dictionary data (issue #327), filed through the
 * public API and worked by the admin in the moderation queue. The headword
 * string is the durable pointer; the optional word row reference nulls out
 * when a dictionary update replaces the entry's rows (#328).
 */
@Entity('suggestions')
@Index('IDX_SUGGESTION_STATUS', ['status'])
@Index('IDX_SUGGESTION_HEADWORD', ['headword'])
export class Suggestion {
  /** @asType integer */
  @PrimaryGeneratedColumn()
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  id!: number;

  @CreateDateColumn({ type: checkIsPostgres() ? 'timestamptz' : 'datetime' })
  @IsDate()
  createdAt!: Date;

  @Column({ type: 'varchar', length: 128 })
  headword!: string;

  @ManyToOne(() => EnWord, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'word_id' })
  word?: EnWord | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  dataset_version!: string | null;

  @Column({ type: 'simple-enum', enum: SuggestionStatusE, default: SuggestionStatusE.new })
  status!: SuggestionStatusE;

  // A free-text report, or an edit of the word form (issue #327): the
  // admin applies every stored change in one click through the normal
  // edit services
  @Column({ type: 'simple-enum', enum: SuggestionKindE, default: SuggestionKindE.report })
  kind!: SuggestionKindE;

  // Every touched target with its { field: { before, after } } diff; the
  // target ids carry no FK — the stored proposal must survive a target's
  // deletion so the admin can still read what was suggested
  @Column({ type: checkIsPostgres() ? 'jsonb' : 'simple-json', nullable: true })
  edits!: SuggestionEditT[] | null;

  // The name the sender asked to be credited by (issue #531), kept only
  // when they agreed to have it shown and exported; goes into the history
  // of the edit when the correction is applied
  @Column({ type: 'varchar', length: 128, nullable: true })
  author_name!: string | null;
}
