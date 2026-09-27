// The Express.Multer.File type comes from the multer typings' global augmentation
/// <reference types="multer" />
import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Response } from 'express';
import { MAX_SOURCE_UPLOAD_BYTES } from '../../../../../core/constants/dataset_catalog';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { AdminGuard } from '../../../AuthModule/guards/admin.guard';
import { EnDatasetInstallService, SourceUploadT } from './enDatasetInstall.service';

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'vocab-bloom-import', 'sources');
const FIELDS = ['file', 'pronunciations'] as const;

// Where multer put an upload is a part of the request: it is read, unpacked
// and deleted only when it lies in the folder the uploads go to
const uploadOf = (files: Express.Multer.File[] | undefined): SourceUploadT | undefined => {
  const file = files?.[0];
  if (!file) return undefined;
  const stored = path.resolve(UPLOAD_TMP_DIR, path.basename(file.path));
  if (!stored.startsWith(`${UPLOAD_TMP_DIR}${path.sep}`)) {
    throw new BadRequestException(ErrorCodes.dataset_upload_missing);
  }
  return { path: stored, originalname: file.originalname };
};

/**
 * A dataset of the catalog installed from the file of its source (issue
 * #527): `file` is what the catalog tells the admin to download,
 * `pronunciations` the CMUdict file a WordNet dataset may take. The progress
 * streams back as NDJSON like the one of an import: the conversion first,
 * then the stages of the import.
 */
@ApiTags('Datasets')
@Controller('/api/en/datasets')
export class EnDatasetInstallController {
  constructor(private readonly installService: EnDatasetInstallService) {}

  @UseGuards(AdminGuard)
  @Post(':name/install')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: Object.fromEntries(FIELDS.map((field) => [field, { type: 'string', format: 'binary' }])),
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      FIELDS.map((name) => ({ name, maxCount: 1 })),
      { dest: UPLOAD_TMP_DIR, limits: { fileSize: MAX_SOURCE_UPLOAD_BYTES } },
    ),
  )
  async install(
    @Param('name') name: string,
    @UploadedFiles() files: Partial<Record<(typeof FIELDS)[number], Express.Multer.File[]>> | undefined,
    @Res() res: Response,
  ): Promise<void> {
    return this.installService.install(
      name,
      { file: uploadOf(files?.file), pronunciations: uploadOf(files?.pronunciations) },
      res,
    );
  }
}
