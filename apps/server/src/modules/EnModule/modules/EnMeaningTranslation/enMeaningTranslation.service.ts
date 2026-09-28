import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChangeActionE, ChangeEntityE } from '../../../../../types';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  AddMeaningTranslationReqT,
  AddMeaningTranslationResT,
  DeleteMeaningTranslationResT,
  EditMeaningTranslationReqT,
  EditMeaningTranslationResT,
} from '../../../../../types';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { EnMeaningTranslation } from '../../entities/en_meaning_translation.entity';
import { EnMeaning } from '../../entities/en_meaning.entity';
import { markEntryUserModified } from '../../utils/markEntryUserModified';
import { articleOf, recordChange } from '../../utils/changes/recordChange';
import {
  changedFields,
  createdFields,
  deletedFields,
  translationRecord,
  translationSnapshot,
} from '../../utils/changes/snapshots';

@Injectable()
export class EnMeaningTranslationService {
  private readonly logger = new Logger(EnMeaningTranslationService.name);

  constructor(
    @InjectRepository(EnMeaning)
    private readonly enMeaningsRep: Repository<EnMeaning>,

    @InjectRepository(EnMeaningTranslation)
    private readonly enMeaningTranslationRep: Repository<EnMeaningTranslation>,
  ) {}

  async addMeaningTranslation(
    body: AddMeaningTranslationReqT,
    manager?: EntityManager,
  ): Promise<AddMeaningTranslationResT> {
    const em = manager ?? this.enMeaningTranslationRep.manager;
    const { meaning_id, id: _id, ...newMeaning } = body;
    const meaning = await em.getRepository(EnMeaning).findOne({
      where: { id: meaning_id },
      relations: { word: { word: true, base_form: { word: true } } },
    });

    if (!meaning) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    const add = async (tx: EntityManager): Promise<EnMeaningTranslation> => {
      const saved = await tx.getRepository(EnMeaningTranslation).save({ meaning, ...newMeaning });
      // inside addWord's / addMeaning's transaction the parent row holds the translation
      if (manager) {
        await markEntryUserModified(tx, meaning.word.word.word);
        return saved;
      }
      await recordChange(tx, {
        ...articleOf(meaning.word),
        entity: ChangeEntityE.meaning_translation,
        action: ChangeActionE.create,
        record: translationRecord(saved, meaning),
        diff: createdFields(translationSnapshot(saved)),
      });
      return saved;
    };
    const res = manager ? await add(manager) : await em.transaction(add);
    this.logger.log(`Meaning translation added to meaning id=${meaning_id}, id=${res.id}`);
    return { success: true, id: res.id };
  }

  async editMeaningTranslation(body: EditMeaningTranslationReqT): Promise<EditMeaningTranslationResT> {
    const meaningTr = await this.enMeaningTranslationRep.findOne({
      where: { id: body.id },
      relations: { meaning: { word: { word: true, base_form: { word: true } } } },
    });

    if (!meaningTr) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    const valuesBefore = translationSnapshot(meaningTr);
    const recordBefore = translationRecord(meaningTr, meaningTr.meaning);

    if (body.title && body.title !== meaningTr.title) meaningTr.title = body.title;
    if (body.definition && body.definition !== meaningTr.definition) meaningTr.definition = body.definition;
    if (body.language && body.language !== meaningTr.language) meaningTr.language = body.language;
    if (body.variant_of_words && body.variant_of_words.join() !== meaningTr.variants_of_words?.join())
      meaningTr.variants_of_words = body.variant_of_words;

    await this.enMeaningTranslationRep.manager.transaction(async (em) => {
      await em.getRepository(EnMeaningTranslation).save(meaningTr);
      await recordChange(em, {
        ...articleOf(meaningTr.meaning.word),
        entity: ChangeEntityE.meaning_translation,
        action: ChangeActionE.update,
        record: recordBefore,
        diff: changedFields(valuesBefore, translationSnapshot(meaningTr)),
      });
    });
    this.logger.log(`Meaning translation updated, id=${body.id}`);
    return { success: true };
  }

  async deleteMeaningTranslation(id: number): Promise<DeleteMeaningTranslationResT> {
    // loaded first only for the journal: the headword survives the delete
    const meaningTr = await this.enMeaningTranslationRep.findOne({
      where: { id },
      relations: { meaning: { word: { word: true, base_form: { word: true } } } },
    });
    await this.enMeaningTranslationRep.manager.transaction(async (em) => {
      await em.getRepository(EnMeaningTranslation).delete({ id });
      if (!meaningTr) return;
      await recordChange(em, {
        ...articleOf(meaningTr.meaning.word),
        entity: ChangeEntityE.meaning_translation,
        action: ChangeActionE.delete,
        record: translationRecord(meaningTr, meaningTr.meaning),
        diff: deletedFields(translationSnapshot(meaningTr)),
      });
    });

    this.logger.log(`Meaning translation deleted, id=${id}`);

    return { success: true };
  }
}
