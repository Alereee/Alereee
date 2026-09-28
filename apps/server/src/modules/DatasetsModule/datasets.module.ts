import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Settings } from '../SettingsModule/entities/settings.entity';
import { Dataset } from './entities/dataset.entity';
import { DatasetsService } from './datasets.service';
import { DatasetUpdatesService } from './dataset-updates.service';

/**
 * The registry of datasets and the active one (issue #527). Global like the
 * audit journal and the import slot: the import writes into it, the public
 * API and the journal read the active dataset from it. The controller is
 * registered by EnModule so its routes are matched before GET /api/en/:id.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Dataset, Settings])],
  providers: [DatasetsService, DatasetUpdatesService],
  exports: [DatasetsService, DatasetUpdatesService],
})
export class DatasetsModule {}
