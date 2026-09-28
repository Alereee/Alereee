import { Controller, Get, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DATASET_TARGET_PATTERN } from '../../../core/constants/datasets';
import { PublicHeadwordHistoryV1ResT, PublicWordDatasetsV1ResT } from '../../../types';
import { PublicApiThrottlerGuard } from '../../core/guards/public-api-throttler.guard';
import { PUBLIC_API_PREFIX, PUBLIC_API_THROTTLE } from '../../core/utils/public-api';
import { PublicDatasetsCacheInterceptor } from './public-cache.interceptor';
import { PublicWordDatasetsService } from './public-word-datasets.service';
import { DatasetParamPipe } from './utils/dataset-param.pipe';
import { HEADWORD_PARAM } from './public-words.controller';
import { HeadwordParamPipe } from './utils/headword-param.pipe';

const DATASET_PARAM = {
  name: 'dataset',
  description:
    'The name of a dataset of the instance, as `dataset` of a group of `GET /words/{word}/datasets` says it',
  schema: { type: 'string', pattern: DATASET_TARGET_PATTERN.source },
};

/**
 * A headword read from every dataset of the instance (issue #528). The
 * other public routes answer from the dataset that is served; these answer
 * from all of them, each under its own terms.
 */
@ApiTags('Public API v1')
@Controller(`${PUBLIC_API_PREFIX}/words`)
@UseGuards(PublicApiThrottlerGuard)
@Throttle(PUBLIC_API_THROTTLE)
@UseInterceptors(PublicDatasetsCacheInterceptor)
export class PublicWordDatasetsController {
  constructor(private readonly publicWordDatasetsService: PublicWordDatasetsService) {}

  @ApiOperation({
    summary: 'A headword as every dataset of the instance has it, grouped by dataset',
    description:
      'One group per dataset, never merged: the terms of the dataset (`license`, `attribution`, `license_text`, …) ' +
      'and the entries `GET /words/{word}` would answer if that dataset were the served one. The spelling is ' +
      'matched inside each dataset, so a group has its own `word` and `variants`; a dataset without the headword ' +
      'answers an empty `entries`, and the request fails with 404 when no dataset holds it. ' +
      'Entries taken from several groups are bound by the terms of each. One request against the rate limit.',
  })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word/datasets')
  async byHeadword(@Param('word', HeadwordParamPipe) word: string): Promise<PublicWordDatasetsV1ResT> {
    return this.publicWordDatasetsService.getByHeadword(word);
  }

  @ApiOperation({
    summary: 'What was changed or added on the instance in the entries of a headword, in one dataset',
    description:
      'The answer of `GET /words/{word}/history` for a dataset named by its `dataset`: the edits behind ' +
      '`modified: true` of the entries of that group. 404 for a dataset the instance does not hold.',
  })
  @ApiParam(HEADWORD_PARAM)
  @ApiParam(DATASET_PARAM)
  @Get(':word/datasets/:dataset/history')
  async history(
    @Param('word', HeadwordParamPipe) word: string,
    @Param('dataset', DatasetParamPipe) dataset: string,
  ): Promise<PublicHeadwordHistoryV1ResT> {
    return this.publicWordDatasetsService.getHistory(word, dataset);
  }
}
