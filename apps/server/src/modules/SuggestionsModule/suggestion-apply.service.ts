import { Injectable, Logger } from '@nestjs/common';
import { ApplySuggestionResT, ChangeOriginE, SuggestionStatusE, SuggestionTargetE } from '../../../types';
import { withChangeSource } from '../EnModule/utils/changes/context';
import { EnService } from '../EnModule/en.service';
import { EnMeaningService } from '../EnModule/modules/EnMeaning/enMeaning.service';
import { EnMeaningTranslationService } from '../EnModule/modules/EnMeaningTranslation/enMeaningTranslation.service';
import { EnShortTranslationService } from '../EnModule/modules/EnShortTranslation/enShortTranslation.service';
import { SuggestionsService } from './suggestions.service';

/**
 * Applies an edit suggestion in one click (issue #327): the stored `after`
 * values go through the exact edit service the admin UI would call — the
 * change is validated, audited and flags the entry user_modified (#328)
 * like any hand-made edit. Registered in EnModule (not SuggestionsModule):
 * the edit services live there, and importing EnModule from
 * SuggestionsModule would close a module cycle.
 */
@Injectable()
export class SuggestionApplyService {
  private readonly logger = new Logger(SuggestionApplyService.name);

  constructor(
    private readonly suggestionsService: SuggestionsService,
    private readonly enService: EnService,
    private readonly enMeaningService: EnMeaningService,
    private readonly enMeaningTranslationService: EnMeaningTranslationService,
    private readonly enShortTranslationService: EnShortTranslationService,
  ) {}

  async apply(id: number): Promise<ApplySuggestionResT> {
    const suggestion = await this.suggestionsService.getApplicable(id);

    // one edit service call per touched target, in the stored order. A
    // missing target (deleted, or replaced by a dictionary update since the
    // report was filed) surfaces as the edit service's own 404 — the edits
    // already applied stand, the suggestion stays new and a retry redoes
    // the remainder as no-op diffs.
    // the history says where the edits came from (issue #531)
    const source = { origin: ChangeOriginE.suggestion, suggestion_id: id, author: suggestion.author_name };
    await withChangeSource(source, async () => {
      for (const edit of suggestion.edits ?? []) {
        const values: Record<string, string> = {};
        for (const [field, change] of Object.entries(edit.changes)) {
          values[field] = change.after;
        }
        switch (edit.target_type) {
          case SuggestionTargetE.word:
            await this.enService.editWord(edit.target_id, values);
            break;
          case SuggestionTargetE.meaning:
            await this.enMeaningService.editMeaning({ id: edit.target_id, ...values });
            break;
          case SuggestionTargetE.meaning_translation:
            await this.enMeaningTranslationService.editMeaningTranslation({ id: edit.target_id, ...values });
            break;
          case SuggestionTargetE.short_translation:
            await this.enShortTranslationService.editShortTranslation({ id: edit.target_id, ...values });
            break;
        }
      }
    });

    await this.suggestionsService.updateStatus(id, SuggestionStatusE.resolved);
    this.logger.log(`Suggestion #${id} applied (${suggestion.edits?.length ?? 0} targets)`);
    return { success: true };
  }
}
