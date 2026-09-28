import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SuggestionKindE, SuggestionTargetE } from '../../../../types';
import {
  MAX_SUGGESTION_EDITS,
  SUGGESTION_AUTHOR_MAX_LENGTH,
  SUGGESTION_MESSAGE_MAX_LENGTH,
  SUGGESTION_MESSAGE_MIN_LENGTH,
} from '../constants';

// One edited target of the word form; the proposed field values are checked
// against the per-target whitelist in the service
export class SuggestionEditV1DTO {
  @ApiProperty({ enum: SuggestionTargetE })
  @IsEnum(SuggestionTargetE)
  target_type!: SuggestionTargetE;

  @ApiProperty({ description: 'Id of the targeted row, from the word answers' })
  @IsInt()
  @IsPositive()
  target_id!: number;

  @ApiProperty({
    description:
      'The proposed field values, e.g. { "definition": "…" }. The accepted fields depend on ' +
      'target_type; unknown fields, empty values and values equal to the current ones are rejected',
  })
  @IsObject()
  changes!: Record<string, string>;
}

// Body of POST /api/v1/suggestions (issue #327). Part of the public
// contract: changes only with a new version prefix. Two flows share it:
// a free-text report (the default kind), and a structured edit whose
// proposed field values the admin can apply in one click.
export class CreateSuggestionV1ReqDTO {
  @ApiProperty({ description: 'The headword the report is about; must exist in the dictionary' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  headword!: string;

  @ApiPropertyOptional({
    description: 'Id of the entry (part of speech) the report points at, from the word answers',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  word_id?: number | undefined;

  @ApiPropertyOptional({ enum: SuggestionKindE, default: SuggestionKindE.report })
  @IsOptional()
  @IsEnum(SuggestionKindE)
  kind?: SuggestionKindE | undefined;

  @ApiProperty({
    required: false,
    description:
      'What is wrong and, ideally, what would be right. Required for a report; an optional comment on an edit',
  })
  @ValidateIf((o: CreateSuggestionV1ReqDTO) => o.kind !== SuggestionKindE.edit || o.message !== undefined)
  @IsString()
  @MinLength(SUGGESTION_MESSAGE_MIN_LENGTH)
  @MaxLength(SUGGESTION_MESSAGE_MAX_LENGTH)
  message?: string | undefined;

  @ApiPropertyOptional({
    type: [SuggestionEditV1DTO],
    description: 'Edit flow: every touched target of the word form with its proposed values',
  })
  @ValidateIf((o: CreateSuggestionV1ReqDTO) => o.kind === SuggestionKindE.edit)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SUGGESTION_EDITS)
  @ValidateNested({ each: true })
  @Type(() => SuggestionEditV1DTO)
  edits?: SuggestionEditV1DTO[] | undefined;

  @ApiPropertyOptional({
    description:
      'The name the sender wants to be credited by (issue #531). Kept only together with ' +
      '`author_consent: true`: once the correction is applied the name is shown next to it and ' +
      'travels with the copies of the data',
    maxLength: SUGGESTION_AUTHOR_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(SUGGESTION_AUTHOR_MAX_LENGTH)
  author_name?: string | undefined;

  @ApiPropertyOptional({
    description: 'The sender agrees that `author_name` is shown and exported; required when a name is given',
  })
  @IsOptional()
  @IsBoolean()
  author_consent?: boolean | undefined;
}
