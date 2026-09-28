import {
  Inject,
  Optional,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionE, AuditEntityTypeE, ChangeActionE, ChangeEntityE } from '../../../types';
import { AuditService } from '../AuditModule/audit.service';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, FindOptionsRelations } from 'typeorm';
import { EnEntry } from './entities/en_entry.entity';
import { EnWord } from './entities/en_word.entity';
import {
  AddResT,
  AddWordFormResT,
  CustomVersionDictionaryOfWord,
  DeleteResT,
  EditCommonInfoOfWordResT,
  EditPhrasalBaseResT,
  EditWordFormResT,
  EnEntryTypesE,
  EnPartOfSpeechE,
  EnWordFormsE,
  EnWordT,
  ResetEntryUserModifiedResT,
} from '../../../types';
import { ErrorCodes } from '../../../core/constants/error_codes';
import { OWN_DATASET_SOURCE } from '../../../core/constants/datasets';
import { getActiveDatasetSource } from '../../core/utils/active-dataset';
import { prepareWordFromDB } from './utils/prepareWordFromDB';
import { articleOf, recordChange } from './utils/changes/recordChange';
import { ARTICLE_RELATIONS, deleteWordRows, dropEntryIfUnused } from './utils/changes/articles';
import {
  articleSnapshot,
  changedFields,
  createdFields,
  deletedFields,
  formRecord,
  formSnapshot,
  wordSnapshot,
} from './utils/changes/snapshots';
import { FULL_WORD_RELATIONS } from './utils/wordRelations';
import { WordRowsService } from './word-rows.service';
import { AddWordReqDTO, AddWordReqFormDTO } from './dto/AddWordReq.dto';
import { AddWordFormReqDTO } from './dto/AddWordFormReq.dto';
import { EditWordFormReqDTO } from './dto/EditWordFormReq.dto';
import { EditCommonInfoOfWordReqDTO } from './dto/EditCommonInfoOfWordReq.dto';
import { EnShortTranslationService } from './modules/EnShortTranslation/enShortTranslation.service';
import { EnMeaningService } from './modules/EnMeaning/enMeaning.service';
import { EditPhrasalBaseReqDTO } from './dto/EditPhrasalBase.dto';

@Injectable()
export class EnService {
  private readonly logger = new Logger(EnService.name);

  // What was done on the instance goes to the audit journal (issue #334) — here,
  // the decision to let an update replace an entry; the edits of the content
  // are the history of the dataset (`recordChange`, issue #531). Optional so
  // test modules that boot without AuditModule still resolve
  @Optional()
  @Inject(AuditService)
  private readonly auditService?: AuditService;

  constructor(
    @InjectRepository(EnWord)
    private readonly enWordsRep: Repository<EnWord>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly enShortTranslationService: EnShortTranslationService,
    private readonly enMeaningService: EnMeaningService,
    private readonly wordRows: WordRowsService,
  ) {}

  async checkWord(word: string, partOfSpeech: EnPartOfSpeechE, forPhrasal: boolean): Promise<number | false> {
    const qb = this.enWordsRep
      .createQueryBuilder('e')
      .innerJoin('e.word', 'w')
      .where('w.word = :word', { word })
      .andWhere('e.part_of_speech = :partOfSpeech', { partOfSpeech });

    if (forPhrasal) {
      qb.leftJoin('e.base_phrasal', 'bp')
        .andWhere('(e.verb___is_phrasal IS NULL OR e.verb___is_phrasal = false)')
        .andWhere('bp.id IS NULL');
    }

    const result = await qb.select('e.id', 'id').getRawOne<{ id: number }>();

    return result?.id ?? false;
  }

  private async addEntry(em: EntityManager, word: string, type: EnEntryTypesE): Promise<EnEntry> {
    return em.getRepository(EnEntry).save({ word, type });
  }
  private async addWordRow(em: EntityManager, entry: EnEntry, data: AddWordReqDTO): Promise<EnWord> {
    const row = await this.getWordRow(data.word, data.part_of_speech, data.form_of_word, em);
    if (row) {
      throw new ConflictException(ErrorCodes.word_already_exists);
    }
    const {
      word: _word,
      base_form: _baseForm,
      short_translations: _shortTranslations,
      meanings: _meanings,
      forms: _forms,
      phrasal_variants: _phrasalVariants,
      id: _id,
      base_phrasal,
      ...other
    } = data;
    let basePhrasalWord: EnWord | null | undefined;
    if (other.part_of_speech === EnPartOfSpeechE.verb && base_phrasal) {
      basePhrasalWord = await this.getWordRow(base_phrasal, EnPartOfSpeechE.verb, EnWordFormsE.base_form, em);
      if (!basePhrasalWord) {
        // the transaction rollback also removes an entry created for this word
        throw new BadRequestException(ErrorCodes.phrasal_base_doesnt_exist);
      }
    }
    return em.getRepository(EnWord).save({
      word: entry,
      ...other,
      ...(basePhrasalWord && { base_phrasal: basePhrasalWord }),
    });
  }

  async getWordRow(
    word: string,
    pos: EnPartOfSpeechE,
    formOfWord: EnWordFormsE,
    manager?: EntityManager,
  ): Promise<EnWord | null> {
    const em = manager ?? this.enWordsRep.manager;
    return em
      .getRepository(EnWord)
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .where('entry.word = :word', { word })
      .andWhere('w.part_of_speech = :pos', { pos })
      .andWhere('w.form_of_word = :formOfWord', { formOfWord })
      .getOne();
  }
  private async getOrAddEntry(em: EntityManager, word: string, type: EnEntryTypesE): Promise<EnEntry> {
    const entry = await em.getRepository(EnEntry).findOne({ where: { word }, relations: { entries: true } });
    if (entry) {
      return entry;
    }
    return this.addEntry(em, word, type);
  }

  private async addFormOfWord(em: EntityManager, wordForm: AddWordReqFormDTO, baseWord: EnWord) {
    const { id: _id, word, ...f } = wordForm;
    const formEntry = await this.getOrAddEntry(em, word, EnEntryTypesE.word);
    const wordRow = await this.getWordRow(word, baseWord.part_of_speech, f.form_of_word, em);
    if (wordRow) {
      return wordRow;
    } else {
      return em.getRepository(EnWord).save({
        word: formEntry,
        ...f,
        part_of_speech: baseWord.part_of_speech,
        base_form: baseWord,
      });
    }
  }

  /**
   * A dataset of a public source holds what people wrote, and says so
   * (issue #531): it carries no notice about generated text, so nothing that
   * is marked as generated by a model is written into it
   */
  private assertNotGenerated(generated: boolean | null | undefined): void {
    if (generated && getActiveDatasetSource() !== OWN_DATASET_SOURCE) {
      throw new BadRequestException(ErrorCodes.generated_not_allowed);
    }
  }

  async addWord(body: AddWordReqDTO): Promise<AddResT> {
    this.assertNotGenerated(body.generated);
    let type = EnEntryTypesE.word;
    if (body.part_of_speech === EnPartOfSpeechE.phrase) {
      type = EnEntryTypesE.phrase;
    }
    if (body.part_of_speech === EnPartOfSpeechE.grammar_pattern) {
      type = EnEntryTypesE.grammar_pattern;
    }
    const baseWord = await this.dataSource.transaction(async (em) => {
      const baseEntry = await this.getOrAddEntry(em, body.word, type);
      const baseWord = await this.addWordRow(em, baseEntry, body);

      if (body.forms) {
        for (const form of body.forms) await this.addFormOfWord(em, form, baseWord);
      }

      if (body.meanings) {
        for (const m of body.meanings) {
          await this.enMeaningService.addMeaning(
            {
              word_id: baseWord.id,
              meaning_level: m.meaning_level,
              language_register: m.language_register,
              categories: m.categories,
              ...m,
            },
            em,
          );
        }
      }

      if (body.short_translations) {
        for (const s of body.short_translations) {
          await this.enShortTranslationService.addShortTranslation(
            {
              language: s.language,
              description: s.description,
              variant_of_words: s.variants_of_words,
              word_id: baseWord.id,
            },
            em,
          );
        }
      }

      // an admin-created word is the admin's own content from the start: kept
      // through the updates, and the history holds everything it came with
      const created = await em
        .getRepository(EnWord)
        .findOneOrFail({ where: { id: baseWord.id }, relations: ARTICLE_RELATIONS });
      await recordChange(em, {
        ...articleOf(created),
        entity: ChangeEntityE.word,
        action: ChangeActionE.create,
        diff: createdFields(articleSnapshot(created)),
      });
      this.logger.log(`Word "${body.word}" (${body.part_of_speech}) created, id=${baseWord.id}`);
      return baseWord;
    });

    // the request echoed back plus the id of the created base entry
    return { ...body, id: baseWord.id };
  }

  async deleteWord(id: number): Promise<DeleteResT> {
    const word = await this.enWordsRep.findOne({
      where: { id },
      relations: { ...ARTICLE_RELATIONS, base_form: { word: true } },
    });
    if (!word) {
      this.logger.warn(`Delete requested for missing word, id=${id}`);
      return { success: false };
    }
    // deleting a form row is an edit of its base word's entry; the flag is a
    // no-op when the delete removes the entry itself (issue #328). What is
    // deleted is read before it is gone: the history keeps its values
    const isForm = Boolean(word.base_form);
    const deleted = isForm ? formSnapshot(word) : articleSnapshot(word);

    await this.dataSource.transaction(async (em) => {
      await deleteWordRows(em, word);
      await recordChange(em, {
        ...articleOf(word),
        entity: isForm ? ChangeEntityE.word_form : ChangeEntityE.word,
        action: ChangeActionE.delete,
        record: isForm ? formRecord(word) : null,
        diff: deletedFields(deleted),
      });
    });
    this.logger.log(`Word "${word.word.word}" deleted, id=${id}`);
    return { success: true };
  }

  /** The row of a word id, or the not-found error every edit answers with */
  private async requireWord(id: number, relations?: FindOptionsRelations<EnWord>): Promise<EnWord> {
    const word = await this.enWordsRep.findOne({ where: { id }, relations });
    if (!word) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    return word;
  }

  async editWord(id: number, body: EditCommonInfoOfWordReqDTO): Promise<EditCommonInfoOfWordResT> {
    this.assertNotGenerated(body.generated);
    const word = await this.requireWord(id, {
      word: true,
      base_form: { word: true },
      base_phrasal: { word: true },
    });

    const valuesBefore = word.base_form ? formSnapshot(word) : wordSnapshot(word);
    const recordBefore = word.base_form ? formRecord(word) : null;
    const {
      verb___transitivity,
      verb___is_irregular,
      noun___irregular_plural,
      noun___always_plural,
      noun___uncountable,
      verb___is_phrasal,
      verb___phrasal_object_pattern,
      noun___is_proper,
      language_register,
      categories,
      is_obsolete,
      description,
      generated_by_model,
      generated,
      word_level,
      transcription,
      is_abbreviation,
      area_variant,
      pattern,
    } = body;

    if (typeof generated === 'boolean' && generated !== word.generated) word.generated = generated;
    if (typeof is_obsolete === 'boolean' && is_obsolete !== word.is_obsolete) word.is_obsolete = is_obsolete;
    if (typeof verb___is_irregular === 'boolean' && verb___is_irregular !== word.verb___is_irregular)
      word.verb___is_irregular = verb___is_irregular;
    if (
      typeof noun___irregular_plural === 'boolean' &&
      noun___irregular_plural !== word.noun___irregular_plural
    )
      word.noun___irregular_plural = noun___irregular_plural;
    if (typeof noun___always_plural === 'boolean' && noun___always_plural !== word.noun___always_plural)
      word.noun___always_plural = noun___always_plural;
    if (typeof noun___uncountable === 'boolean' && noun___uncountable !== word.noun___uncountable)
      word.noun___uncountable = noun___uncountable;
    if (typeof noun___is_proper === 'boolean' && noun___is_proper !== word.noun___is_proper)
      word.noun___is_proper = noun___is_proper;
    if (typeof verb___is_phrasal === 'boolean' && verb___is_phrasal !== word.verb___is_phrasal)
      word.verb___is_phrasal = verb___is_phrasal;
    if (typeof is_abbreviation === 'boolean' && is_abbreviation !== word.is_abbreviation)
      word.is_abbreviation = is_abbreviation;
    if (generated_by_model && generated_by_model !== word.generated_by_model)
      word.generated_by_model = generated_by_model;
    if (description && description !== word.description) word.description = description;
    if (verb___phrasal_object_pattern && verb___phrasal_object_pattern !== word.verb___phrasal_object_pattern)
      word.verb___phrasal_object_pattern = verb___phrasal_object_pattern;
    if (verb___transitivity && verb___transitivity !== word.verb___transitivity)
      word.verb___transitivity = verb___transitivity;
    if (transcription && transcription !== word.transcription) word.transcription = transcription;
    if (word_level && word_level !== word.word_level) word.word_level = word_level;
    if (language_register && language_register !== word.language_register)
      word.language_register = language_register;
    if (area_variant && area_variant !== word.area_variant) word.area_variant = area_variant;
    if (categories && categories.join() !== word.categories?.join()) word.categories = categories;
    if (pattern && pattern.join() !== word.pattern?.join()) word.pattern = pattern;
    // A dialog saved as it was opened changes nothing, and leaves nothing: the
    // entry keeps the version of its dataset, no row is written (issue #531)
    const diff = changedFields(valuesBefore, word.base_form ? formSnapshot(word) : wordSnapshot(word));
    if (!diff) return { success: true };

    // The entry becomes the owner's version of it. The history keeps the
    // version it had: taking the last change of the entry back returns it
    if (word.version !== CustomVersionDictionaryOfWord) {
      diff.version = { before: word.version, after: CustomVersionDictionaryOfWord };
    }
    word.version = CustomVersionDictionaryOfWord;
    await this.dataSource.transaction(async (em) => {
      await em.getRepository(EnWord).save(word);
      await recordChange(em, {
        ...articleOf(word),
        entity: word.base_form ? ChangeEntityE.word_form : ChangeEntityE.word,
        action: ChangeActionE.update,
        record: recordBefore,
        diff,
      });
    });
    this.logger.log(`Word common info updated, id=${id}`);
    return { success: true };
  }

  async editPhrasalBase(body: EditPhrasalBaseReqDTO): Promise<EditPhrasalBaseResT> {
    const word = await this.requireWord(body.id, {
      word: true,
      base_form: { word: true },
      base_phrasal: { word: true },
    });
    const phrasalBase = await this.requireWord(body.phrasal_base_id, { word: true });
    const baseBefore = word.base_phrasal?.word.word ?? null;
    word.base_phrasal = phrasalBase;
    await this.dataSource.transaction(async (em) => {
      await em.getRepository(EnWord).save(word);
      await recordChange(em, {
        ...articleOf(word),
        entity: ChangeEntityE.word,
        action: ChangeActionE.update,
        diff: changedFields({ base_phrasal: baseBefore }, { base_phrasal: phrasalBase.word.word }),
      });
    });
    this.logger.log(`Phrasal base of word id=${body.id} set to id=${body.phrasal_base_id}`);
    return { success: true };
  }

  /**
   * Clears the user-modified flag (issue #328). The entry becomes eligible
   * for replacement again on the next dictionary update; nothing is restored
   * immediately — the admin's content stays until an update runs.
   */
  async resetEntryUserModified(word: string): Promise<ResetEntryUserModifiedResT> {
    const entryRep = this.dataSource.getRepository(EnEntry);
    const entry = await entryRep.findOne({ where: { word } });
    if (!entry) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }
    if (entry.user_modified) {
      await entryRep.update({ word }, { user_modified: false });
      await this.auditService?.record({
        action: AuditActionE.update,
        entityType: AuditEntityTypeE.word,
        headword: word,
        diff: { user_modified: { before: true, after: false } },
      });
      this.logger.log(`User-modified flag cleared for entry "${word}"`);
    }
    return { success: true };
  }

  async getWordById(id: number): Promise<EnWordT> {
    const [res] = await this.wordRows.load([id], FULL_WORD_RELATIONS);

    if (!res) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    return prepareWordFromDB(res);
  }

  async addWordForm(body: AddWordFormReqDTO): Promise<AddWordFormResT> {
    const word = await this.enWordsRep
      .createQueryBuilder('w')
      .innerJoin('w.word', 'entry')
      .where('entry.word = :word', { word: body.word })
      .andWhere('w.form_of_word = :formOfWord', { formOfWord: body.form_of_word })
      .leftJoin('w.base_form', 'baseForm')
      .andWhere('baseForm.id = :baseFormId', { baseFormId: body.base_word_id })
      .getOne();
    if (word) {
      throw new ConflictException(ErrorCodes.word_already_exists);
    }

    const baseWord = await this.requireWord(body.base_word_id, { word: true });
    const res = await this.dataSource.transaction(async (em) => {
      const entry = await this.getOrAddEntry(em, body.word, EnEntryTypesE.word);
      const saved = await em.getRepository(EnWord).save({
        word: entry,
        form_of_word: body.form_of_word,
        area_variant: body.area_variant,
        base_form: baseWord,
        part_of_speech: baseWord.part_of_speech,
        transcription: body.transcription,
      });
      // a new form is an edit of its base word's entry (issue #328)
      await recordChange(em, {
        ...articleOf(baseWord),
        entity: ChangeEntityE.word_form,
        action: ChangeActionE.create,
        record: formRecord(saved),
        diff: createdFields(formSnapshot(saved)),
      });
      return saved;
    });

    this.logger.log(`Word form "${body.word}" added to word id=${body.base_word_id}, id=${res.id}`);

    return { success: true, id: res.id };
  }

  async editWordForm(body: EditWordFormReqDTO): Promise<EditWordFormResT> {
    const word = await this.requireWord(body.id, { word: true, base_form: { word: true } });

    const valuesBefore = formSnapshot(word);
    const recordBefore = formRecord(word);
    await this.dataSource.transaction(async (em) => {
      const wordsRep = em.getRepository(EnWord);

      if (body.word && body.word !== word.word.word) {
        const newEntry = await this.getOrAddEntry(em, body.word, EnEntryTypesE.word);
        const oldWord = word.word.word;
        word.word = newEntry;
        await wordsRep.save(word);

        await dropEntryIfUnused(em, oldWord);
      }

      if (body.transcription && body.transcription !== word.transcription) {
        word.transcription = body.transcription;
      }
      if (body.area_variant && body.area_variant !== word.area_variant) {
        word.area_variant = body.area_variant;
      }

      await wordsRep.save(word);
      await recordChange(em, {
        ...articleOf(word),
        entity: ChangeEntityE.word_form,
        action: ChangeActionE.update,
        record: recordBefore,
        diff: changedFields(valuesBefore, formSnapshot(word)),
      });
    });

    this.logger.log(`Word form updated, id=${body.id}`);

    return { success: true };
  }
}
