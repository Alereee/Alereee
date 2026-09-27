import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ImportSourceKindE } from '../../../../../../types';
import { DATASET_TARGET_PATTERN } from '../../../../../../core/constants/datasets';

export class ImportDictionarySourceDTO {
  @ApiProperty({ enum: ImportSourceKindE })
  @IsEnum(ImportSourceKindE)
  kind!: ImportSourceKindE;

  // A dataset directory or zip archive relative to DICTIONARY_IMPORT_DIR;
  // required for the file source, ignored otherwise
  @ApiProperty({ required: false })
  @ValidateIf((o: ImportDictionarySourceDTO) => o.kind === ImportSourceKindE.file)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  path?: string | undefined;

  // A git ref of the published dataset repo (issue #322): a version tag,
  // a branch or a commit sha; only the HuggingFace source reads it, and
  // without it the moving `main` is imported
  @ApiProperty({ required: false })
  @ValidateIf((o: ImportDictionarySourceDTO) => o.kind === ImportSourceKindE.huggingface)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._/-]+$/)
  revision?: string | undefined;
}

// Without a source the published HuggingFace dataset is imported; the
// dataset version always comes from its manifest.json, never from the client
export class ImportDictionaryReq {
  @ApiProperty({ type: ImportDictionarySourceDTO, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportDictionarySourceDTO)
  source?: ImportDictionarySourceDTO | undefined;

  // Update mode (issue #328): entries already in the dictionary are replaced
  // with the dataset content — except entries the admin edited
  // (user_modified), which are kept. Off, the import only adds what is
  // missing (the historical behavior).
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  update?: boolean | undefined;

  // The dataset of the instance to import into (issue #527): the active one
  // when absent. A name that is not registered yet creates the dataset — a
  // schema of its own — and the active dataset keeps serving meanwhile.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(DATASET_TARGET_PATTERN, { message: 'dataset_name_invalid' })
  dataset?: string | undefined;
}
