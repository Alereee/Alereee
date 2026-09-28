import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicWordsService } from './public-words.service';
import { ListWordsV1QueryDTO } from './dto/ListWordsV1Query.dto';
import { HeadwordTranslationsV1QueryDTO } from './dto/HeadwordTranslationsV1Query.dto';
import { PUBLIC_BATCH_MAX_WORDS, WordsBatchV1ReqDTO } from './dto/WordsBatchV1Req.dto';
import {
  PublicHeadwordFormsV1ResT,
  PublicHeadwordHistoryV1ResT,
  PublicHeadwordLinksV1ResT,
  PublicHeadwordMeaningsV1ResT,
  PublicHeadwordTranslationsV1ResT,
  PublicHeadwordV1ResT,
  PublicWordsBatchV1ResT,
  PublicWordsV1ResT,
  PublicWordV1ResT,
} from '../../../types';
import { PublicApiThrottlerGuard } from '../../core/guards/public-api-throttler.guard';
import { PublicCacheInterceptor } from './public-cache.interceptor';
import { PUBLIC_API_PREFIX, PUBLIC_API_THROTTLE } from '../../core/utils/public-api';
import { HEADWORD_MAX_LENGTH, HeadwordParamPipe } from './utils/headword-param.pipe';

const HEADWORD_PARAM = {
  name: 'word',
  description:
    'Headword spelling, case-insensitive (spaces URL-encoded for phrases). An inflected form resolves to its base entry',
  schema: { type: 'string', minLength: 1, maxLength: HEADWORD_MAX_LENGTH },
};

/** Public reads of dictionary entries (issue #272): by headword (one or a batch, #397), by id, and the filtered list */
@ApiTags('Public API v1')
@Controller(`${PUBLIC_API_PREFIX}/words`)
@UseGuards(PublicApiThrottlerGuard)
@Throttle(PUBLIC_API_THROTTLE)
@UseInterceptors(PublicCacheInterceptor)
export class PublicWordsController {
  constructor(private readonly publicWordsService: PublicWordsService) {}

  @ApiOperation({
    summary: 'List dictionary entries by filters, cursor-paged and ordered by (word, id)',
    description:
      'Every enum filter accepts a repeated key; values of one filter are OR-ed, filters are AND-ed. ' +
      '`search` keeps the headwords starting with the prefix (an autocomplete or an A–Z browser: cacheable, unlike the search). ' +
      'Pass `meta.next_cursor` back as `cursor` to read the next page.',
  })
  @Get('/')
  async list(@Query() query: ListWordsV1QueryDTO): Promise<PublicWordsV1ResT> {
    return this.publicWordsService.listWords(query);
  }

  @ApiOperation({
    summary: `Up to ${PUBLIC_BATCH_MAX_WORDS} headwords in one request`,
    description:
      'Every spelling is matched like `GET /words/{word}`; the answer keeps the request order, collapses ' +
      'duplicates, and lists the spellings without an entry under `meta.not_found` instead of failing. ' +
      'One request against the rate limit, whatever the size of the batch.',
  })
  @HttpCode(200)
  @Post('batch')
  async batch(@Body() body: WordsBatchV1ReqDTO): Promise<PublicWordsBatchV1ResT> {
    return this.publicWordsService.getByHeadwords(body.words);
  }

  @ApiOperation({ summary: 'One dictionary entry by its numeric id' })
  @ApiParam({ name: 'id', type: Number })
  @Get('id/:id')
  async byId(@Param('id', ParseIntPipe) id: number): Promise<PublicWordV1ResT> {
    return { data: await this.publicWordsService.getById(id) };
  }

  @ApiOperation({ summary: 'All entries of a headword: parts of speech, forms, meanings, translations, links' })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word')
  async byHeadword(@Param('word', HeadwordParamPipe) word: string): Promise<PublicHeadwordV1ResT> {
    return this.publicWordsService.getByHeadword(word);
  }

  @ApiOperation({ summary: 'The meanings of a headword across its entries' })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word/meanings')
  async meanings(@Param('word', HeadwordParamPipe) word: string): Promise<PublicHeadwordMeaningsV1ResT> {
    return this.publicWordsService.getMeaningsByHeadword(word);
  }

  @ApiOperation({
    summary: 'The synonyms of a headword, per meaning',
    description:
      'One item per linked headword and meaning; each names its `meaning_id`, `word_id` and `part_of_speech`.',
  })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word/synonyms')
  async synonyms(@Param('word', HeadwordParamPipe) word: string): Promise<PublicHeadwordLinksV1ResT> {
    return this.publicWordsService.getLinksByHeadword(word, 'synonyms');
  }

  @ApiOperation({
    summary: 'The antonyms of a headword, per meaning',
    description:
      'One item per linked headword and meaning; each names its `meaning_id`, `word_id` and `part_of_speech`.',
  })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word/antonyms')
  async antonyms(@Param('word', HeadwordParamPipe) word: string): Promise<PublicHeadwordLinksV1ResT> {
    return this.publicWordsService.getLinksByHeadword(word, 'antonyms');
  }

  @ApiOperation({ summary: 'The short and per-meaning translations of a headword' })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word/translations')
  async translations(
    @Param('word', HeadwordParamPipe) word: string,
    @Query() query: HeadwordTranslationsV1QueryDTO,
  ): Promise<PublicHeadwordTranslationsV1ResT> {
    return this.publicWordsService.getTranslationsByHeadword(word, query.language);
  }

  @ApiOperation({
    summary: 'What was changed or added on the instance in the entries of a headword',
    description:
      'The edits that still show in what is served, the latest first, with the values before and after: ' +
      'the entries of such a headword carry `modified: true`. Empty for a headword served as its source has it.',
  })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word/history')
  async history(@Param('word', HeadwordParamPipe) word: string): Promise<PublicHeadwordHistoryV1ResT> {
    return this.publicWordsService.getHistoryByHeadword(word);
  }

  @ApiOperation({ summary: 'The inflected forms of a headword across its entries' })
  @ApiParam(HEADWORD_PARAM)
  @Get(':word/forms')
  async forms(@Param('word', HeadwordParamPipe) word: string): Promise<PublicHeadwordFormsV1ResT> {
    return this.publicWordsService.getFormsByHeadword(word);
  }
}
