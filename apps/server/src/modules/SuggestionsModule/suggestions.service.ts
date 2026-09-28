import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuditActionE,
  AuditEntityTypeE,
  DeleteSuggestionResT,
  PublicSuggestionCreatedV1T,
  SuggestionChangesT,
  SuggestionEditT,
  SuggestionKindE,
  SuggestionListT,
  SuggestionStatusE,
  SuggestionT,
  SuggestionTargetE,
  UpdateSuggestionStatusResT,
} from '../../../types';
import { ErrorCodes } from '../../../core/constants/error_codes';
import { AuditService } from '../AuditModule/audit.service';
import { SettingsService } from '../SettingsModule/settings.service';
import { DATASET_VERSION_SETTINGS_FIELD } from '../EnModule/modules/EnImportDictionary/constants';
import { EnEntry } from '../EnModule/entities/en_entry.entity';
import { EnWord } from '../EnModule/entities/en_word.entity';
import { EnMeaning } from '../EnModule/entities/en_meaning.entity';
import { EnMeaningTranslation } from '../EnModule/entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../EnModule/entities/en_short_translation.entity';
import { Suggestion } from './entities/suggestion.entity';
import { ListSuggestionsQueryDTO } from './dto/ListSuggestionsQuery.dto';
import { CreateSuggestionV1ReqDTO } from './dto/CreateSuggestionV1Req.dto';
import { EDITABLE_FIELDS, MAX_OPEN_SUGGESTIONS, SUGGESTION_VALUE_MAX_LENGTH } from './constants';
import { LIST_DEFAULT_LIMIT } from '../EnModule/modules/EnAdminLists/dto/PaginationQuery.dto';

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  // the moderation actions are admin mutations and land in the journal (#334)
  @Optional()
  @Inject(AuditService)
  private readonly auditService?: AuditService;

  constructor(
    @InjectRepository(Suggestion)
    private readonly suggestionsRep: Repository<Suggestion>,
    @InjectRepository(EnEntry)
    private readonly entriesRep: Repository<EnEntry>,
    @InjectRepository(EnWord)
    private readonly wordsRep: Repository<EnWord>,
    @InjectRepository(EnMeaning)
    private readonly meaningsRep: Repository<EnMeaning>,
    @InjectRepository(EnMeaningTranslation)
    private readonly meaningTranslationsRep: Repository<EnMeaningTranslation>,
    @InjectRepository(EnShortTranslation)
    private readonly shortTranslationsRep: Repository<EnShortTranslation>,
    private readonly settingsService: SettingsService,
  ) {}

  /** The public intake (issue #327): validates the target, stores the report */
  async create(body: CreateSuggestionV1ReqDTO): Promise<PublicSuggestionCreatedV1T> {
    const kind = body.kind ?? SuggestionKindE.report;
    if (kind === SuggestionKindE.report && !body.message) {
      throw new BadRequestException(ErrorCodes.suggestion_invalid);
    }
    // a name is personal data that will be published: taken with the word of the sender only
    const author = body.author_name?.trim() || null;
    if (author && body.author_consent !== true) {
      throw new BadRequestException(ErrorCodes.suggestion_invalid);
    }

    // the same case-insensitive match the public word reads use; the stored
    // headword is the canonical spelling of the entry
    const entry = await this.entriesRep
      .createQueryBuilder('e')
      .where('LOWER(e.word) = LOWER(:headword)', { headword: body.headword })
      .getOne();
    if (!entry) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    let word: EnWord | null = null;
    if (body.word_id !== undefined) {
      word = await this.wordsRep.findOne({ where: { id: body.word_id } });
      if (!word) {
        throw new NotFoundException(ErrorCodes.word_doesnt_found);
      }
    }

    // the edit flow: for every touched target, check it belongs to the
    // headword, whitelist the fields and snapshot the current values
    const edits = kind === SuggestionKindE.edit ? await this.buildEdits(entry.word, body.edits ?? []) : null;

    const open = await this.suggestionsRep.count({ where: { status: SuggestionStatusE.new } });
    if (open >= MAX_OPEN_SUGGESTIONS) {
      // the queue is a moderation inbox, not unbounded storage: past the cap
      // the intake refuses instead of hoarding what nobody reads
      throw new ServiceUnavailableException(ErrorCodes.suggestion_queue_full);
    }

    const saved = await this.suggestionsRep.save(
      this.suggestionsRep.create({
        headword: entry.word,
        word,
        message: body.message ?? '',
        dataset_version: await this.getDatasetVersion(),
        status: SuggestionStatusE.new,
        kind,
        edits,
        author_name: author,
      }),
    );
    this.logger.log(`Suggestion #${saved.id} (${kind}) filed for "${entry.word}"`);
    return { id: saved.id, status: saved.status };
  }

  /**
   * The reader edits the word form as a whole: every touched target goes
   * through the same validation and comes back with the current values
   * snapshotted; targets whose proposal equals the current values drop out.
   * At least one real change must remain.
   */
  private async buildEdits(
    headword: string,
    proposed: Array<{ target_type: SuggestionTargetE; target_id: number; changes: Record<string, string> }>,
  ): Promise<SuggestionEditT[]> {
    const edits: SuggestionEditT[] = [];
    for (const edit of proposed) {
      const changes = await this.buildChanges(headword, edit.target_type, edit.target_id, edit.changes);
      if (changes) edits.push({ target_type: edit.target_type, target_id: edit.target_id, changes });
    }
    if (edits.length === 0) {
      throw new BadRequestException(ErrorCodes.suggestion_invalid);
    }
    return edits;
  }

  /**
   * Loads the current values of one target and pairs them with the
   * proposal: { field: { before, after } }. Rejects unknown fields, empty
   * or oversized values and a target that does not belong to the headword;
   * null when every proposed value equals the current one.
   */
  private async buildChanges(
    headword: string,
    targetType: SuggestionTargetE,
    targetId: number,
    proposed: Record<string, string>,
  ): Promise<SuggestionChangesT | null> {
    const allowed: readonly string[] = EDITABLE_FIELDS[targetType];
    const fields = Object.keys(proposed);
    const valid =
      fields.length > 0 &&
      fields.every(
        (field) =>
          allowed.includes(field) &&
          typeof proposed[field] === 'string' &&
          (proposed[field] as string).trim().length > 0 &&
          (proposed[field] as string).length <= SUGGESTION_VALUE_MAX_LENGTH,
      );
    if (!valid) {
      throw new BadRequestException(ErrorCodes.suggestion_invalid);
    }

    const current = await this.loadTargetValues(headword, targetType, targetId);

    const changes: SuggestionChangesT = {};
    for (const field of fields) {
      const after = (proposed[field] as string).trim();
      const before = current[field] ?? null;
      if (after === before) continue; // nothing to change for this field
      changes[field] = { before, after };
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }

  /** Current values of the whitelisted fields; throws 404 unless the target belongs to the headword */
  private async loadTargetValues(
    headword: string,
    targetType: SuggestionTargetE,
    targetId: number,
  ): Promise<Record<string, string | null>> {
    switch (targetType) {
      case SuggestionTargetE.word: {
        const row = await this.wordsRep.findOne({ where: { id: targetId }, relations: { word: true } });
        if (!row || row.word.word !== headword) throw new NotFoundException(ErrorCodes.word_doesnt_found);
        return { description: row.description ?? null, transcription: row.transcription ?? null };
      }
      case SuggestionTargetE.meaning: {
        const row = await this.meaningsRep.findOne({
          where: { id: targetId },
          relations: { word: { word: true } },
        });
        if (!row || row.word.word.word !== headword) {
          throw new NotFoundException(ErrorCodes.word_doesnt_found);
        }
        return { title: row.title ?? null, definition: row.definition ?? null };
      }
      case SuggestionTargetE.meaning_translation: {
        const row = await this.meaningTranslationsRep.findOne({
          where: { id: targetId },
          relations: { meaning: { word: { word: true } } },
        });
        if (!row || row.meaning.word.word.word !== headword) {
          throw new NotFoundException(ErrorCodes.word_doesnt_found);
        }
        return { title: row.title ?? null, definition: row.definition ?? null };
      }
      case SuggestionTargetE.short_translation: {
        const row = await this.shortTranslationsRep.findOne({
          where: { id: targetId },
          relations: { word: { word: true } },
        });
        if (!row || row.word.word.word !== headword) {
          throw new NotFoundException(ErrorCodes.word_doesnt_found);
        }
        return { description: row.description ?? null };
      }
    }
  }

  /** The row an apply works on (issue #327): must be an open edit suggestion */
  async getApplicable(id: number): Promise<Suggestion> {
    const suggestion = await this.suggestionsRep.findOne({ where: { id } });
    if (!suggestion) {
      throw new NotFoundException(ErrorCodes.suggestion_doesnt_found);
    }
    if (
      suggestion.kind !== SuggestionKindE.edit ||
      suggestion.status !== SuggestionStatusE.new ||
      !suggestion.edits?.length
    ) {
      throw new BadRequestException(ErrorCodes.suggestion_not_applicable);
    }
    return suggestion;
  }

  async list(query: ListSuggestionsQueryDTO): Promise<SuggestionListT> {
    const page = query.page ?? 1;
    const limit = query.limit ?? LIST_DEFAULT_LIMIT;

    const qb = this.suggestionsRep.createQueryBuilder('s').leftJoinAndSelect('s.word', 'w');
    if (query.status?.length) qb.andWhere('s.status IN (:...statuses)', { statuses: query.status });
    if (query.kind?.length) qb.andWhere('s.kind IN (:...kinds)', { kinds: query.kind });
    if (query.search) {
      qb.andWhere('LOWER(s.headword) LIKE :search', { search: `${query.search.toLowerCase()}%` });
    }

    const total = await qb.clone().getCount();
    const rows = await qb
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    return {
      items: rows.map((row) => this.toItem(row)),
      total,
      page,
      limit,
      has_more: page * limit < total,
    };
  }

  async updateStatus(id: number, status: SuggestionStatusE): Promise<UpdateSuggestionStatusResT> {
    const suggestion = await this.suggestionsRep.findOne({ where: { id } });
    if (!suggestion) {
      throw new NotFoundException(ErrorCodes.suggestion_doesnt_found);
    }
    if (suggestion.status !== status) {
      await this.suggestionsRep.update({ id }, { status });
      await this.auditService?.record({
        action: AuditActionE.update,
        entityType: AuditEntityTypeE.suggestion,
        entityId: id,
        headword: suggestion.headword,
        diff: { status: { before: suggestion.status, after: status } },
      });
      this.logger.log(`Suggestion #${id} ("${suggestion.headword}") marked ${status}`);
    }
    return { success: true };
  }

  async delete(id: number): Promise<DeleteSuggestionResT> {
    // loaded first only for the journal: the headword survives the delete
    const suggestion = await this.suggestionsRep.findOne({ where: { id } });
    if (!suggestion) {
      throw new NotFoundException(ErrorCodes.suggestion_doesnt_found);
    }
    await this.suggestionsRep.delete({ id });
    await this.auditService?.record({
      action: AuditActionE.delete,
      entityType: AuditEntityTypeE.suggestion,
      entityId: id,
      headword: suggestion.headword,
    });
    this.logger.log(`Suggestion #${id} ("${suggestion.headword}") deleted`);
    return { success: true };
  }

  private toItem(row: Suggestion): SuggestionT {
    return {
      id: row.id,
      created_at: row.createdAt.toISOString(),
      headword: row.headword,
      word_id: row.word?.id ?? null,
      message: row.message,
      dataset_version: row.dataset_version,
      status: row.status,
      kind: row.kind,
      edits: row.edits,
      author_name: row.author_name ?? null,
    };
  }

  private async getDatasetVersion(): Promise<string | null> {
    try {
      return await this.settingsService.findOne(DATASET_VERSION_SETTINGS_FIELD);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }
}
