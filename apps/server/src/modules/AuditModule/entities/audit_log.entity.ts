import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { checkIsPostgres } from '../../../../configuration';
import { AuditActionE, AuditDiffT, AuditEntityTypeE, AuditTriggerE } from '../../../../types';

/**
 * One admin change or import run (issue #334): operational data of this
 * instance — never part of the dictionary export, the dataset or the
 * public API. Rows older than AUDIT_RETENTION_DAYS are deleted.
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('IDX_AUDIT_CREATED_AT')
  @CreateDateColumn({ type: checkIsPostgres() ? 'timestamptz' : 'datetime' })
  createdAt!: Date;

  @Column({ type: 'varchar', length: 16 })
  trigger!: AuditTriggerE;

  @Column({ type: 'varchar', length: 16 })
  action!: AuditActionE;

  @Index('IDX_AUDIT_ENTITY')
  @Column({ type: 'varchar', length: 32 })
  entity_type!: AuditEntityTypeE;

  @Column({ type: 'int', nullable: true })
  entity_id!: number | null;

  // denormalised so "everything about run" filters without a join — and
  // survives the entity being deleted
  @Column({ type: 'varchar', length: 512, nullable: true })
  headword!: string | null;

  // only the changed fields, { field: { before, after } }
  @Column({ type: checkIsPostgres() ? 'jsonb' : 'simple-json', nullable: true })
  diff!: AuditDiffT | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  request_id!: string | null;

  // the dataset that was active when the row was written (issue #527):
  // entity ids are per dataset; null on rows older than the datasets
  @Column({ type: 'varchar', length: 40, nullable: true })
  dataset!: string | null;
}
