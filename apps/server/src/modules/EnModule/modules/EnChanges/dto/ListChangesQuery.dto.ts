import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ChangeActionE, ChangeEntityE, ChangeOriginE } from '../../../../../../types';
import { PaginationQueryDTO, toArray, toBoolean } from '../../EnAdminLists/dto/PaginationQuery.dto';

/** Filters of the history of edits (GET /api/en/changes, issue #531) */
export class ListChangesQueryDTO extends PaginationQueryDTO {
  @ApiPropertyOptional({ description: 'The headword, exactly' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  headword?: string;

  @ApiPropertyOptional({
    description: 'The article of the headword; the edits about every article of it are listed too',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  part_of_speech?: string;

  @ApiPropertyOptional({ description: 'Headword prefix, case-insensitive' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @ApiPropertyOptional({
    description: 'The beginning of the name of the reader who sent the correction, case-insensitive',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  author?: string;

  @ApiPropertyOptional({ enum: ChangeEntityE, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ChangeEntityE, { each: true })
  entity?: ChangeEntityE[];

  @ApiPropertyOptional({ enum: ChangeActionE, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ChangeActionE, { each: true })
  action?: ChangeActionE[];

  @ApiPropertyOptional({ enum: ChangeOriginE, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ChangeOriginE, { each: true })
  origin?: ChangeOriginE[];

  @ApiPropertyOptional({ description: 'Only the changes that still show in what is served' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}
