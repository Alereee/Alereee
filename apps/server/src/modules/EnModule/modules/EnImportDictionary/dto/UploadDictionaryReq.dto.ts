import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { DATASET_TARGET_PATTERN } from '../../../../../../core/constants/datasets';

/**
 * Text fields of the multipart upload: the manifest values typed by hand
 * when no manifest.json is uploaded (they override the file's values when
 * both are given). The files travel in the `archive` / `words` /
 * `phrasal_verbs` / `grammar_patterns` / `phrases` / `manifest` fields.
 */
export class UploadDictionaryReqDTO {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string | undefined;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  synonym_links?: number | undefined;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  antonym_links?: number | undefined;

  // the dataset of the instance to import into (issue #527), see ImportDictionaryReq
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(DATASET_TARGET_PATTERN, { message: 'dataset_name_invalid' })
  dataset?: string | undefined;
}
