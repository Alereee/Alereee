import { Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DatasetT, DatasetsListT } from '../../../types';
import { AdminGuard } from '../AuthModule/guards/admin.guard';
import { DatasetsService } from './datasets.service';

/**
 * The datasets of the instance (issue #527): admin surface only. The list is
 * the catalog the code ships with what is installed; a dataset is installed
 * from a file of its source (EnDatasetInstall) and its terms are the
 * catalog's. Installing, activating and deleting need a driver with schemas
 * — on SQLite they answer 409 `datasets_not_supported`.
 */
@ApiTags('Datasets')
@Controller('/api/en/datasets')
export class DatasetsController {
  constructor(private readonly datasetsService: DatasetsService) {}

  @Get()
  @UseGuards(AdminGuard)
  async list(): Promise<DatasetsListT> {
    return this.datasetsService.list();
  }

  @Post(':name/activate')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async activate(@Param('name') name: string): Promise<DatasetT> {
    return this.datasetsService.activate(name);
  }

  @Delete(':name')
  @UseGuards(AdminGuard)
  async remove(@Param('name') name: string): Promise<{ success: true }> {
    await this.datasetsService.remove(name);
    return { success: true };
  }
}
