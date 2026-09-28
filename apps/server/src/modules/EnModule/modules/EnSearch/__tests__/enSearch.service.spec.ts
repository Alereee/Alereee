import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { WordRowsService } from '../../../word-rows.service';
import { Repository } from 'typeorm';

import { EnWord } from '../../../entities/en_word.entity';
import { EnEntryTypesE } from '../../../../../../types';
import { EnSearchService } from '../enSearch.service';

type QbMock = {
  innerJoin: jest.Mock;
  innerJoinAndSelect: jest.Mock;
  leftJoin: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  take: jest.Mock;
  limit: jest.Mock;
  getMany: jest.Mock;
  getRawMany: jest.Mock;
};

const createQbMock = (): QbMock => {
  const qb = {} as QbMock;
  qb.innerJoin = jest.fn(() => qb);
  qb.innerJoinAndSelect = jest.fn(() => qb);
  qb.leftJoin = jest.fn(() => qb);
  qb.leftJoinAndSelect = jest.fn(() => qb);
  qb.select = jest.fn(() => qb);
  qb.addSelect = jest.fn(() => qb);
  qb.where = jest.fn(() => qb);
  qb.andWhere = jest.fn(() => qb);
  qb.groupBy = jest.fn(() => qb);
  qb.orderBy = jest.fn(() => qb);
  qb.addOrderBy = jest.fn(() => qb);
  qb.take = jest.fn(() => qb);
  qb.limit = jest.fn(() => qb);
  qb.getMany = jest.fn(async () => []);
  qb.getRawMany = jest.fn(async () => []);
  return qb;
};

describe('EnSearchService', () => {
  let service: EnSearchService;
  let qbMocks: QbMock[];
  let repMock: Pick<Repository<EnWord>, 'createQueryBuilder' | 'find'>;

  beforeEach(() => {
    qbMocks = [];
    repMock = {
      createQueryBuilder: jest.fn(() => {
        const qb = createQbMock();
        qbMocks.push(qb);
        return qb;
      }),
      find: jest.fn(async () => []),
    } as unknown as Pick<Repository<EnWord>, 'createQueryBuilder' | 'find'>;

    service = new EnSearchService(
      repMock as Repository<EnWord>,
      {
        load: async () => [],
        modifiedArticles: async () => ({ has: () => false }),
      } as unknown as WordRowsService,
    );
  });

  // every LIKE tier binds its types the same way; the any-matches tier runs last
  const getIncludedTypesFromAnyMatchesTier = () => {
    let last: EnEntryTypesE[] | undefined;
    for (const qb of qbMocks) {
      for (const call of qb.andWhere.mock.calls) {
        const [condition, params] = call as [string, { includedTypes?: EnEntryTypesE[] }];
        if (condition.includes('entry.type IN')) last = params.includedTypes;
      }
    }
    return last;
  };

  it('ограничивает тир anyMatches переданным type (issue #169)', async () => {
    await service.searchFlat({ search: 'take', type: EnEntryTypesE.phrase, limit: 10 });

    expect(getIncludedTypesFromAnyMatchesTier()).toEqual([EnEntryTypesE.phrase]);
  });

  it('без type тир anyMatches ищет по всем типам', async () => {
    await service.searchFlat({ search: 'take', type: undefined, limit: 10 });

    expect(getIncludedTypesFromAnyMatchesTier()).toEqual([
      EnEntryTypesE.grammar_pattern,
      EnEntryTypesE.phrase,
      EnEntryTypesE.word,
    ]);
  });
});
