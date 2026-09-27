import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { LessThan, Repository } from 'typeorm';
import { ConfigurationError } from '../../../configuration';
import { getActiveDatasetName } from '../../core/utils/active-dataset';
import {
  AuditActionE,
  AuditDiffT,
  AuditEntityTypeE,
  AuditEntryT,
  AuditListT,
  AuditTriggerE,
} from '../../../types';
import { LIST_DEFAULT_LIMIT } from '../EnModule/modules/EnAdminLists/dto/PaginationQuery.dto';
import { AuditLog } from './entities/audit_log.entity';
import { ListAuditQueryDTO } from './dto/ListAuditQuery.dto';

export const DEFAULT_AUDIT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days audit rows are kept (0 = forever); anything unparseable fails startup */
export const getAuditRetentionDays = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.AUDIT_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_AUDIT_RETENTION_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0) {
    throw new ConfigurationError(
      `AUDIT_RETENTION_DAYS must be a whole number of days (0 = keep forever), got "${raw}"`,
    );
  }
  return days;
};

export type AuditRecordT = {
  action: AuditActionE;
  entityType: AuditEntityTypeE;
  entityId?: number | null;
  headword?: string | null;
  diff?: AuditDiffT | null;
  trigger?: AuditTriggerE;
};

/**
 * The journal of admin changes (issue #334). `record` never throws: an
 * audit failure must not break the mutation it describes — it is logged
 * and the mutation's own result stands.
 */
@Injectable()
export class AuditService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly retentionDays = getAuditRetentionDays();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRep: Repository<AuditLog>,
    // absent in test modules that boot without the pino LoggerModule
    @Optional() private readonly pinoLogger?: PinoLogger,
  ) {}

  async record(entry: AuditRecordT): Promise<void> {
    try {
      await this.auditRep.save(
        this.auditRep.create({
          trigger: entry.trigger ?? AuditTriggerE.admin,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId ?? null,
          headword: entry.headword ?? null,
          diff: entry.diff ?? null,
          request_id: this.requestId(),
          dataset: getActiveDatasetName(),
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Audit row not written (${entry.action} ${entry.entityType}${
          entry.entityId ? ` id=${entry.entityId}` : ''
        }): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The x-request-id of the request being handled, from the request-scoped log context (issue #280) */
  private requestId(): string | null {
    const bindings = this.pinoLogger?.logger?.bindings?.();
    const reqId = (bindings as { reqId?: unknown } | undefined)?.reqId;
    return typeof reqId === 'string' || typeof reqId === 'number' ? String(reqId) : null;
  }

  async list(query: ListAuditQueryDTO): Promise<AuditListT> {
    const page = query.page ?? 1;
    const limit = query.limit ?? LIST_DEFAULT_LIMIT;

    const qb = this.auditRep.createQueryBuilder('a');
    if (query.entity_type?.length) {
      qb.andWhere('a.entity_type IN (:...entityTypes)', { entityTypes: query.entity_type });
    }
    if (query.action?.length) qb.andWhere('a.action IN (:...actions)', { actions: query.action });
    if (query.trigger?.length) qb.andWhere('a.trigger IN (:...triggers)', { triggers: query.trigger });
    if (query.search)
      qb.andWhere('LOWER(a.headword) LIKE :search', { search: `${query.search.toLowerCase()}%` });
    if (query.from) qb.andWhere('a.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('a.createdAt <= :to', { to: new Date(query.to) });

    const total = await qb.clone().getCount();
    const rows = await qb
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    return {
      items: rows.map((row) => this.toEntry(row)),
      total,
      page,
      limit,
      has_more: page * limit < total,
    };
  }

  private toEntry(row: AuditLog): AuditEntryT {
    return {
      id: row.id,
      created_at: row.createdAt.toISOString(),
      trigger: row.trigger,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      headword: row.headword,
      diff: row.diff,
      request_id: row.request_id,
      dataset: row.dataset ?? null,
    };
  }

  /** Rows older than the retention are deleted on start and then daily */
  async cleanup(): Promise<void> {
    if (this.retentionDays === 0) return;
    const cutoff = new Date(Date.now() - this.retentionDays * DAY_MS);
    try {
      const result = await this.auditRep.delete({ createdAt: LessThan(cutoff) });
      if (result.affected) {
        this.logger.log(`Audit log: ${result.affected} rows older than ${this.retentionDays} days deleted`);
      }
    } catch (error) {
      this.logger.warn(`Audit cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onApplicationBootstrap(): void {
    void this.cleanup();
    if (this.retentionDays > 0) {
      this.cleanupTimer = setInterval(() => void this.cleanup(), DAY_MS);
      this.cleanupTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }
}
