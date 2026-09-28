import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, QueryFailedError } from 'typeorm';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import {
  ChangeListT,
  ChangeOriginE,
  ChangeT,
  ForgetChangeAuthorResT,
  RevertChangeResT,
} from '../../../../../types';
import { DatasetsService } from '../../../DatasetsModule/datasets.service';
import { Suggestion } from '../../../SuggestionsModule/entities/suggestion.entity';
import { EnChange } from '../../entities/en_change.entity';
import { EnEntry } from '../../entities/en_entry.entity';
import { withChangeSource } from '../../utils/changes/context';
import { isRevertible, revertChange } from '../../utils/changes/revertChange';
import { LIST_DEFAULT_LIMIT } from '../EnAdminLists/dto/PaginationQuery.dto';
import { escapeLike } from '../EnSearch/utils/escapeLike';
import { ListChangesQueryDTO } from './dto/ListChangesQuery.dto';

// the drivers bind a few hundred parameters at most
const BATCH = 500;

// what a reader is shown of one entry; an entry edited more often than that shows its latest edits
export const PUBLIC_HISTORY_LIMIT = 200;

export const toChange = (row: EnChange): ChangeT => ({
  id: row.id,
  created_at: new Date(row.created_at).toISOString(),
  headword: row.headword,
  part_of_speech: row.part_of_speech,
  entity: row.entity,
  action: row.action,
  record: row.record,
  diff: row.diff,
  origin: row.origin,
  suggestion_id: row.suggestion_id,
  author: row.author,
  superseded_at: row.superseded_at ? new Date(row.superseded_at).toISOString() : null,
  revertible: isRevertible(row),
});

/**
 * The history of edits as it is read and undone (issue #531). The rows are
 * written where the edits are made (`recordChange`); here they are listed,
 * taken back one by one, and relieved of a name on request.
 */
@Injectable()
export class EnChangesService {
  private readonly logger = new Logger(EnChangesService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    // absent in the unit tests that build the service by hand
    @Optional() private readonly datasets?: DatasetsService,
  ) {}

  async list(query: ListChangesQueryDTO): Promise<ChangeListT> {
    const page = query.page ?? 1;
    const limit = query.limit ?? LIST_DEFAULT_LIMIT;

    const qb = this.dataSource.getRepository(EnChange).createQueryBuilder('c');
    if (query.headword) qb.andWhere('c.headword = :headword', { headword: query.headword });
    if (query.part_of_speech) {
      qb.andWhere('(c.part_of_speech = :partOfSpeech OR c.part_of_speech IS NULL)', {
        partOfSpeech: query.part_of_speech,
      });
    }
    if (query.search) {
      qb.andWhere('LOWER(c.headword) LIKE :search', { search: `${query.search.toLowerCase()}%` });
    }
    if (query.author?.trim()) {
      qb.andWhere('LOWER(c.author) LIKE :author', {
        author: `${escapeLike(query.author.trim().toLowerCase())}%`,
      });
    }
    if (query.entity?.length) qb.andWhere('c.entity IN (:...entities)', { entities: query.entity });
    if (query.action?.length) qb.andWhere('c.action IN (:...actions)', { actions: query.action });
    if (query.origin?.length) qb.andWhere('c.origin IN (:...origins)', { origins: query.origin });
    if (query.active === true) qb.andWhere('c.superseded_at IS NULL');
    if (query.active === false) qb.andWhere('c.superseded_at IS NOT NULL');

    const total = await qb.clone().getCount();
    const rows = await qb
      .orderBy('c.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    return { items: rows.map(toChange), total, page, limit, has_more: page * limit < total };
  }

  /** The edits of the headwords that still show in what is served, the latest first */
  async activeOf(headwords: readonly string[]): Promise<EnChange[]> {
    if (headwords.length === 0) return [];
    return this.dataSource.getRepository(EnChange).find({
      where: { headword: In([...headwords]), superseded_at: IsNull() },
      order: { id: 'DESC' },
      take: PUBLIC_HISTORY_LIMIT,
    });
  }

  /**
   * How many headwords the active dataset serves with edits that still show:
   * what a reader meets that is not, or not only, what the source says. A
   * headword that was deleted is not served and is not counted.
   */
  async countModifiedEntries(): Promise<number> {
    const row = await this.dataSource
      .getRepository(EnChange)
      .createQueryBuilder('c')
      .select('COUNT(DISTINCT c.headword)', 'n')
      .where('c.superseded_at IS NULL')
      .andWhere((qb) => {
        const served = qb.subQuery().select('1').from(EnEntry, 'e').where('e.word = c.headword').getQuery();
        return `EXISTS ${served}`;
      })
      .getRawOne<{ n: string | number }>();
    return Number(row?.n ?? 0);
  }

  async revert(id: number): Promise<RevertChangeResT> {
    const change = await this.dataSource.getRepository(EnChange).findOne({ where: { id } });
    if (!change) throw new NotFoundException(ErrorCodes.change_doesnt_found);
    if (!isRevertible(change)) throw new ConflictException(ErrorCodes.change_not_revertible);

    try {
      await withChangeSource({ origin: ChangeOriginE.revert, superseded: true }, () =>
        this.dataSource.transaction((em) => revertChange(em, change)),
      );
    } catch (error) {
      // values the database does not take: the row came from a file and says what no record can hold
      if (error instanceof QueryFailedError) {
        this.logger.warn(`Change id=${id} was not taken back: ${error.message}`);
        throw new ConflictException(ErrorCodes.change_not_revertible);
      }
      throw error;
    }
    this.logger.log(`Change id=${id} of "${change.headword}" taken back`);
    return { success: true };
  }

  private async forgetIn(em: EntityManager, author: string): Promise<number> {
    const changes = em.getRepository(EnChange);
    const named = await changes
      .createQueryBuilder('c')
      .select('c.headword', 'headword')
      .distinct(true)
      .where('c.author = :author', { author })
      .getRawMany<{ headword: string }>();
    const inChanges = await changes.update({ author }, { author: null });
    const inSuggestions = await em
      .getRepository(Suggestion)
      .update({ author_name: author }, { author_name: null });

    // what a reader is shown of these entries changed: their pages are read again
    const headwords = named.map((row) => row.headword);
    for (let from = 0; from < headwords.length; from += BATCH) {
      await em
        .getRepository(EnEntry)
        .update({ word: In(headwords.slice(from, from + BATCH)) }, { updateAt: new Date() });
    }
    return (inChanges.affected ?? 0) + (inSuggestions.affected ?? 0);
  }

  /**
   * Takes a name out of the history and of the reports, in every dataset of
   * the instance: the edits stay, nobody is named by them. What was already
   * exported is out of reach — the form says so before a name is given.
   */
  async forgetAuthor(author: string): Promise<ForgetChangeAuthorResT> {
    const name = author.trim();
    let forgotten = 0;
    const installed = this.datasets ? await this.datasets.installed() : [];
    if (installed.length === 0) {
      forgotten = await this.dataSource.transaction((em) => this.forgetIn(em, name));
    }
    for (const dataset of installed) {
      const connection = await (this.datasets as DatasetsService).connect(dataset);
      try {
        forgotten += await connection.manager.transaction((em) => this.forgetIn(em, name));
      } finally {
        await connection.close();
      }
    }
    this.logger.log(`A name was taken out of the history: ${forgotten} rows`);
    return { success: true, forgotten };
  }
}
