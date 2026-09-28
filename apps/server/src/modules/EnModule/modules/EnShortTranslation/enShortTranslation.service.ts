import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChangeActionE, ChangeEntityE } from '../../../../../types';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { EnWord } from '../../entities/en_word.entity';
import { EnShortTranslation } from '../../entities/en_short_translation.entity';
import {
  AddShortTranslationResT,
  DeleteShortTranslationResT,
  EditShortTranslationResT,
} from '../../../../../types';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { AddShortTranslationReqDTO } from './dto/AddShortTranslationReq.dto';
import { EditShortTranslationReqDTO } from './dto/EditShortTranslationReq.dto';
import { markEntryUserModified } from '../../utils/markEntryUserModified';
import { articleOf, recordChange } from '../../utils/changes/recordChange';
import {
  changedFields,
  createdFields,
  deletedFields,
  shortTranslationRecord,
  shortTranslationSnapshot,
} from '../../utils/changes/snapshots';

@Injectable()
export class EnShortTranslationService {
  private readonly logger = new Logger(EnShortTranslationService.name);

  constructor(
    @InjectRepository(EnWord)
    private readonly enWordsRep: Repository<EnWord>,

    @InjectRepository(EnShortTranslation)
    private readonly enShortTranslationRep: Repository<EnShortTranslation>,
  ) {}

  async addShortTranslation(
    body: AddShortTranslationReqDTO,
    manager?: EntityManager,
  ): Promise<AddShortTranslationResT> {
    const em = manager ?? this.enShortTranslationRep.manager;
    const word = await em
      .getRepository(EnWord)
      .findOne({ where: { id: body.word_id }, relations: { word: true, base_form: { word: true } } });

    if (!word) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    const add = async (tx: EntityManager): Promise<EnShortTranslation> => {
      const saved = await tx.getRepository(EnShortTranslation).save({
        word: word,
        language: body.language,
        description: body.description,
        variants_of_words: body.variant_of_words,
      });
      // inside addWord's transaction the word's own row holds the translation
      if (manager) {
        await markEntryUserModified(tx, word.word.word);
        return saved;
      }
      await recordChange(tx, {
        ...articleOf(word),
        entity: ChangeEntityE.short_translation,
        action: ChangeActionE.create,
        record: shortTranslationRecord(saved),
        diff: createdFields(shortTranslationSnapshot(saved)),
      });
      return saved;
    };
    const res = manager ? await add(manager) : await em.transaction(add);
    this.logger.log(`Short translation added to word id=${body.word_id}, id=${res.id}`);

    return { success: true, id: res.id };
  }

  async deleteShortTranslation(id: number): Promise<DeleteShortTranslationResT> {
    // loaded first only for the journal: the headword survives the delete
    const tr = await this.enShortTranslationRep.findOne({
      where: { id },
      relations: { word: { word: true, base_form: { word: true } } },
    });
    await this.enShortTranslationRep.manager.transaction(async (em) => {
      await em.getRepository(EnShortTranslation).delete({ id });
      if (!tr) return;
      await recordChange(em, {
        ...articleOf(tr.word),
        entity: ChangeEntityE.short_translation,
        action: ChangeActionE.delete,
        record: shortTranslationRecord(tr),
        diff: deletedFields(shortTranslationSnapshot(tr)),
      });
    });
    this.logger.log(`Short translation deleted, id=${id}`);
    return { success: true };
  }

  async editShortTranslation(body: EditShortTranslationReqDTO): Promise<EditShortTranslationResT> {
    const tr = await this.enShortTranslationRep.findOne({
      where: { id: body.id },
      relations: { word: { word: true, base_form: { word: true } } },
    });

    if (!tr) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    const valuesBefore = shortTranslationSnapshot(tr);
    const recordBefore = shortTranslationRecord(tr);
    if (body.description && body.description !== tr.description) {
      tr.description = body.description;
    }
    if (body.language && body.language !== tr.language) {
      tr.language = body.language;
    }

    if (body.variant_of_words && body.variant_of_words.join() !== tr.variants_of_words.join()) {
      tr.variants_of_words = body.variant_of_words;
    }

    await this.enShortTranslationRep.manager.transaction(async (em) => {
      await em.getRepository(EnShortTranslation).save(tr);
      await recordChange(em, {
        ...articleOf(tr.word),
        entity: ChangeEntityE.short_translation,
        action: ChangeActionE.update,
        record: recordBefore,
        diff: changedFields(valuesBefore, shortTranslationSnapshot(tr)),
      });
    });
    this.logger.log(`Short translation updated, id=${body.id}`);
    return { success: true };
  }
}
