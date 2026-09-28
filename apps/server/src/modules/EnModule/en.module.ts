import { Module } from '@nestjs/common';
import { AuditModule } from '../AuditModule/audit.module';
import { AuditController } from '../AuditModule/audit.controller';
import { DatasetsModule } from '../DatasetsModule/datasets.module';
import { DatasetsController } from '../DatasetsModule/datasets.controller';
import { SuggestionsModule } from '../SuggestionsModule/suggestions.module';
import { SuggestionsController } from '../SuggestionsModule/suggestions.controller';
import { SuggestionApplyService } from '../SuggestionsModule/suggestion-apply.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from '../SettingsModule/settings.module';
import { EnController } from './en.controller';
import { EnService } from './en.service';
import { WordRowsService } from './word-rows.service';
import { DICTIONARY_ENTITIES } from './entities/dictionary-entities';
import { EnShortTranslationService } from './modules/EnShortTranslation/enShortTranslation.service';
import { EnShortTranslationController } from './modules/EnShortTranslation/enShortTranslation.controller';
import { EnMeaningTranslationController } from './modules/EnMeaningTranslation/enMeaningTranslation.controller';
import { EnMeaningTranslationService } from './modules/EnMeaningTranslation/enMeaningTranslation.service';
import { EnMeaningController } from './modules/EnMeaning/enMeaning.controller';
import { EnMeaningService } from './modules/EnMeaning/enMeaning.service';
import { EnImportDictionaryService } from './modules/EnImportDictionary/enImportDictionary.service';
import { EnImportDictionaryController } from './modules/EnImportDictionary/enImportDictionary.controller';
import { DictionaryBootstrapService } from './modules/EnImportDictionary/dictionaryBootstrap.service';
import { ImportStatusModule } from './modules/EnImportDictionary/importStatus.module';
import { EnDatasetInstallController } from './modules/EnDatasetInstall/enDatasetInstall.controller';
import { EnDatasetInstallService } from './modules/EnDatasetInstall/enDatasetInstall.service';
import { EnSearchService } from './modules/EnSearch/enSearch.service';
import { EnStatisticsController } from './modules/EnStatistics/enStatistics.controller';
import { EnStatisticsService } from './modules/EnStatistics/enStatistics.service';
import { EnAdminListsController } from './modules/EnAdminLists/enAdminLists.controller';
import { EnAdminListsService } from './modules/EnAdminLists/enAdminLists.service';
import { EnChangesController } from './modules/EnChanges/enChanges.controller';
import { EnChangesService } from './modules/EnChanges/enChanges.service';

@Module({
  imports: [
    // the import slot (issue #268), global so HealthModule reads it too; imported here
    // so EnModule stays self-contained for the tests that boot it alone
    ImportStatusModule,
    AuditModule,
    // the registry of datasets and the active one (issue #527)
    DatasetsModule,
    // provides SuggestionsService for the moderation controller below (issue #327)
    SuggestionsModule,
    TypeOrmModule.forFeature(DICTIONARY_ENTITIES),
    // the import service records the dataset version of the last import
    SettingsModule,
  ],
  controllers: [
    // EnStatisticsController and EnAdminListsController must be registered before
    // EnController, otherwise GET /api/en/statistics, /api/en/words, /api/en/meanings
    // and /api/en/meaning-translations are swallowed by the GET /api/en/:id route
    EnStatisticsController,
    EnAdminListsController,
    // the journal's and the moderation queue's routes must also be matched
    // before GET /api/en/:id
    AuditController,
    SuggestionsController,
    // …and so must /api/en/datasets (issue #527)
    DatasetsController,
    // a dataset installed from the file of its source: converted, then imported
    EnDatasetInstallController,
    // the history of edits (issue #531): /api/en/changes, before GET /api/en/:id as well
    EnChangesController,
    EnController,
    EnShortTranslationController,
    EnMeaningTranslationController,
    EnMeaningController,
    EnImportDictionaryController,
  ],
  providers: [
    WordRowsService,
    EnService,
    EnShortTranslationService,
    EnMeaningTranslationService,
    EnMeaningService,
    EnImportDictionaryService,
    EnDatasetInstallService,
    DictionaryBootstrapService,
    EnSearchService,
    EnStatisticsService,
    EnAdminListsService,
    EnChangesService,
    // one-click accept of an edit suggestion (issue #327): needs the edit
    // services above, so it lives in this module's context
    SuggestionApplyService,
  ],
  // the public API reuses the search service, the statistics counters and the history of edits
  exports: [EnService, EnSearchService, EnStatisticsService, WordRowsService, EnChangesService],
})
export class EnModule {}
