import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The name to take out of the history (POST /api/en/changes/forget-author, issue #531) */
export class ForgetChangeAuthorReqDTO {
  @ApiProperty({ description: 'The name as it is shown, exactly' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  author!: string;
}
