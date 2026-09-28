import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnModule } from '../EnModule/en.module';
import { SettingsModule } from '../SettingsModule/settings.module';
import { EnEntry } from '../EnModule/entities/en_entry.entity';
import { EnWord } from '../EnModule/entities/en_word.entity';
import { EnMeaning } from '../EnModule/entities/en_meaning.entity';
import { EnMeaningTranslation } from '../EnModule/entities/en_meaning_translation.entity';
import { EnShortTranslation } from '../EnModule/entities/en_short_translation.entity';
import { PublicSearchController } from './public-search.controller';
import { PublicWordsController } from './public-words.controller';
import { PublicDictionaryController } from './public-dictionary.controller';
import { PublicWordsService } from './public-words.service';
import { PublicMetaService } from './public-meta.service';
import { DictionaryLastModifiedService } from './dictionary-last-modified.service';
import { PublicCacheInterceptor, PublicDatasetsCacheInterceptor } from './public-cache.interceptor';
import { DatasetsLastModifiedService } from './datasets-last-modified.service';
import { PublicWordDatasetsController } from './public-word-datasets.controller';
import { PublicWordDatasetsService } from './public-word-datasets.service';
import { PublicOpenApiController } from './public-openapi.controller';
import { PublicOpenApiService } from './public-openapi.service';

/**
 * The public, read-only, versioned surface of the dictionary (`/api/v1`,
 * issues #271, #272): no authentication, nothing that mutates data, one rate
 * limit for the whole prefix, caching headers on every GET (#274), the
 * OpenAPI contract at /openapi.json (#273). Backed by the same services and
 * mappers as the admin API.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EnEntry, EnWord, EnMeaning, EnMeaningTranslation, EnShortTranslation]),
    EnModule,
    // the dataset version of the last import lives in the settings store
    SettingsModule,
  ],
  controllers: [
    PublicSearchController,
    // before the reads of the served dataset: /words/id/datasets is about the
    // headword "id", and /words/id/{id} of the next controller would take it
    PublicWordDatasetsController,
    PublicWordsController,
    PublicDictionaryController,
    PublicOpenApiController,
  ],
  providers: [
    PublicWordsService,
    PublicMetaService,
    DictionaryLastModifiedService,
    PublicCacheInterceptor,
    PublicWordDatasetsService,
    DatasetsLastModifiedService,
    PublicDatasetsCacheInterceptor,
    PublicOpenApiService,
  ],
})
export class PublicApiModule {}
