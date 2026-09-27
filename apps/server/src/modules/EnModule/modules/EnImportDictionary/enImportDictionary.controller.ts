// The Express.Multer.File type comes from the multer typings' global augmentation
/// <reference types="multer" />
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Response } from 'express';
import { EnImportDictionaryService } from './enImportDictionary.service';
import { AdminGuard } from '../../../AuthModule/guards/admin.guard';
import { ImportDictionaryReq } from './dto/ImportDictionaryReq.dto';
import { UploadDictionaryReqDTO } from './dto/UploadDictionaryReq.dto';
import { DatasetManifestT, ImportSourcesT } from '../../../../../types';
import type { ImportStatusT } from '../../../../../types';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { MAX_UPLOAD_BYTES, UPLOAD_ARCHIVE_FIELD, UPLOAD_FILE_FIELDS } from './constants';
import { ImportStatusService } from './importStatus.service';
import { UploadedFilesByFieldT } from './sources';

// Uploaded files land here until the import has unpacked them; multer
// creates the directory on first use
const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'vocab-bloom-import', 'uploads');
const UPLOAD_FIELDS = [UPLOAD_ARCHIVE_FIELD, ...Object.keys(UPLOAD_FILE_FIELDS)];

@ApiTags('En_Words')
@Controller('/api/en/dictionary/')
export class EnImportDictionaryController {
  constructor(
    private readonly enImportDictionaryService: EnImportDictionaryService,
    private readonly importStatus: ImportStatusService,
  ) {}

  @UseGuards(AdminGuard)
  @Get('manifest')
  async getManifest(): Promise<DatasetManifestT> {
    return this.enImportDictionaryService.getManifest();
  }

  @UseGuards(AdminGuard)
  @Get('import/sources')
  async getImportSources(): Promise<ImportSourcesT> {
    return this.enImportDictionaryService.getImportSources();
  }

  /** What is running (or last ran) in the import slot: the admin banner polls this (issue #268) */
  @UseGuards(AdminGuard)
  @Get('import/status')
  getImportStatus(): ImportStatusT {
    return this.importStatus.snapshot();
  }

  @UseGuards(AdminGuard)
  @Post('import')
  async importDictionary(@Body() body: ImportDictionaryReq, @Res() res: Response): Promise<void> {
    return this.enImportDictionaryService.importDictionary(body, res);
  }

  // A zip produced by GET /export in the `archive` field, or the dataset
  // files in their own fields (any subset of the jsonl slots; the manifest
  // as a file or as the text fields of UploadDictionaryReqDTO); the progress
  // streams back as NDJSON exactly like the other import
  @UseGuards(AdminGuard)
  @Post('import/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ...Object.fromEntries(UPLOAD_FIELDS.map((field) => [field, { type: 'string', format: 'binary' }])),
        version: { type: 'string' },
        dataset: { type: 'string' },
        synonym_links: { type: 'integer' },
        antonym_links: { type: 'integer' },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      UPLOAD_FIELDS.map((name) => ({ name, maxCount: 1 })),
      { dest: UPLOAD_TMP_DIR, limits: { fileSize: MAX_UPLOAD_BYTES } },
    ),
  )
  async importUploadedDictionary(
    @UploadedFiles() files: Record<string, Express.Multer.File[]> | undefined,
    @Body() body: UploadDictionaryReqDTO,
    @Res() res: Response,
  ): Promise<void> {
    const byField: UploadedFilesByFieldT = Object.fromEntries(
      Object.entries(files ?? {}).map(([field, list]) => [
        field,
        list.map((f) => ({ path: f.path, originalname: f.originalname })),
      ]),
    );
    if (Object.values(byField).flat().length === 0) {
      throw new BadRequestException(ErrorCodes.dataset_upload_missing);
    }
    return this.enImportDictionaryService.importUploadedDictionary(
      byField,
      { version: body.version, synonym_links: body.synonym_links, antonym_links: body.antonym_links },
      res,
      body.dataset,
    );
  }

  @UseGuards(AdminGuard)
  @Get('export')
  async exportDictionary(@Res() res: Response): Promise<void> {
    return this.enImportDictionaryService.exportDictionary(res);
  }

  @UseGuards(AdminGuard)
  @Get('export/download/:exportId')
  async downloadExport(@Param('exportId') exportId: string, @Res() res: Response) {
    await this.enImportDictionaryService.streamExportFile(exportId, res);
  }
}
