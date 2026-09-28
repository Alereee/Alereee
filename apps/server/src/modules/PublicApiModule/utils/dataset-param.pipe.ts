import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DATASET_TARGET_PATTERN } from '../../../../core/constants/datasets';

// The :dataset path param of the public API (issue #528): a name is what
// the catalog can call a dataset, anything else is refused before the
// registry is asked
@Injectable()
export class DatasetParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !DATASET_TARGET_PATTERN.test(value)) {
      throw new BadRequestException('dataset must be the name of a dataset');
    }
    return value;
  }
}
