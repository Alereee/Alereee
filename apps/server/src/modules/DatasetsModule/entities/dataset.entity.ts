import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { checkIsPostgres } from '../../../../configuration';

const timestamp = (): 'timestamptz' | 'datetime' => (checkIsPostgres() ? 'timestamptz' : 'datetime');

/**
 * The registry of the instance's dictionary datasets (issue #527): one row
 * per dataset with the schema its tables live in and the terms of its data.
 * Operational data of this instance, in `public` with the settings — never
 * part of an export.
 */
@Entity('datasets')
export class Dataset {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ type: timestamp() })
  createdAt!: Date;

  @Column({ type: 'varchar', length: 40, unique: true })
  name!: string;

  // the Postgres schema of the dataset's tables; `public` for the default one
  @Column({ type: 'varchar', length: 63, unique: true })
  schema!: string;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @Column({ type: 'varchar', length: 8, default: 'en' })
  language!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  version!: string | null;

  @Column({ type: 'varchar', length: 64 })
  license!: string;

  @Column({ type: 'text' })
  license_url!: string;

  @Column({ type: 'text' })
  attribution!: string;

  @Column({ type: 'text', nullable: true })
  attribution_url!: string | null;

  @Column({ type: 'text', nullable: true })
  notice!: string | null;

  @Column({ type: timestamp(), nullable: true })
  imported_at!: Date | null;

  // when the dataset last became the active one: a switch is a change of
  // everything the public API serves, so it counts into Last-Modified
  @Column({ type: timestamp(), nullable: true })
  activated_at!: Date | null;
}
