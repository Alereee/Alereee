import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChangeActionE, ChangeEntityE } from '../../../../../types';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AddMeaningResT, DeleteMeaningResT, EditMeaningResT } from '../../../../../types';
import { ErrorCodes } from '../../../../../core/constants/error_codes';
import { EnMeaning } from '../../entities/en_meaning.entity';
import { AddMeaningReqDTO } from './dto/AddMeaningReq.dto';
import { EditMeaningReqDTO } from './dto/EditMeaningReq.dto';
import { EnWord } from '../../entities/en_word.entity';
import { EnEntry } from '../../entities/en_entry.entity';
import { EnMeaningTranslationService } from '../EnMeaningTranslation/enMeaningTranslation.service';
import { markEntryUserModified } from '../../utils/markEntryUserModified';
import { articleOf, recordChange } from '../../utils/changes/recordChange';
import {
  changedFields,
  createdFields,
  deletedFields,
  meaningRecord,
  meaningSnapshot,
} from '../../utils/changes/snapshots';
import { normalizeWordLinks, WORD_LINK_KINDS, WordLinkKindT } from '../../utils/normalizeWordLinks';
import { loadEntries, resolveBaseFormHeadwords } from '../../utils/findBaseFormHeadwords';

const LINK_LABELS: Record<WordLinkKindT, string> = { synonyms: 'Synonyms', antonyms: 'Antonyms' };
const MISSING_LINK_ERRORS: Record<WordLinkKindT, ErrorCodes> = {
  synonyms: ErrorCodes.synonym_doesnt_exist,
  antonyms: ErrorCodes.antonym_doesnt_exist,
};

// A word cannot mean the same and the opposite for one sense; the check runs
// on the resolved dictionary spellings, so two variants of one word collide too
const assertNoSynonymAntonymConflict = (
  synonyms: EnEntry[],
  antonyms: EnEntry[],
  headword: string,
  logger: Logger,
): void => {
  const antonymWords = new Set(antonyms.map((e) => e.word));
  const both = synonyms.map((e) => e.word).filter((w) => antonymWords.has(w));
  if (both.length > 0) {
    logger.warn(`Words listed as both synonym and antonym of "${headword}": ${both.join(', ')}`);
    throw new BadRequestException(ErrorCodes.synonym_antonym_conflict);
  }
};

@Injectable()
export class EnMeaningService {
  private readonly logger = new Logger(EnMeaningService.name);

  constructor(
    @InjectRepository(EnWord)
    private readonly enWordsRep: Repository<EnWord>,

    @InjectRepository(EnMeaning)
    private readonly enMeaningsRep: Repository<EnMeaning>,

    private readonly enMeaningTranslationService: EnMeaningTranslationService,
  ) {}

  /**
   * Turns a list of linked words (synonyms or antonyms) into links to existing
   * dictionary entries. The list is normalized first (trimmed, lowercase,
   * unique, without the headword); every remaining word must name the headword
   * of a base-form entry (inflected forms like "ran" do not qualify) —
   * directly or through a spelling variant such as "absent-minded" for
   * "absentminded" — otherwise the request is rejected: a link is a reference
   * to a word, not free text. The stored link always uses the dictionary
   * spelling.
   */
  async resolveLinkedEntries(
    kind: WordLinkKindT,
    words: readonly string[] | null | undefined,
    headword: string,
    manager?: EntityManager,
  ): Promise<EnEntry[]> {
    const em = manager ?? this.enMeaningsRep.manager;
    const normalized = normalizeWordLinks(words, headword);
    if (normalized.length === 0) return [];

    const resolved = await resolveBaseFormHeadwords(em, normalized);
    const missing = normalized.filter((w) => !resolved.has(w));
    if (missing.length > 0) {
      this.logger.warn(
        `${LINK_LABELS[kind]} not found as base-form words for "${headword}": ${missing.join(', ')}`,
      );
      throw new BadRequestException(MISSING_LINK_ERRORS[kind]);
    }
    // dictionary spellings, deduplicated (two variants may name one word) and
    // without the headword itself, in a stable order
    const headwords = normalizeWordLinks(
      normalized.map((w) => resolved.get(w) as string),
      headword,
    );
    return loadEntries(em, headwords);
  }

  /** Resolves both link lists of a meaning; a word listed in both is rejected */
  private async resolveWordLinks(
    links: { synonyms?: readonly string[] | null | undefined; antonyms?: readonly string[] | null | undefined },
    headword: string,
    manager?: EntityManager,
  ): Promise<{ synonyms: EnEntry[]; antonyms: EnEntry[] }> {
    const synonyms = await this.resolveLinkedEntries('synonyms', links.synonyms, headword, manager);
    const antonyms = await this.resolveLinkedEntries('antonyms', links.antonyms, headword, manager);
    assertNoSynonymAntonymConflict(synonyms, antonyms, headword, this.logger);
    return { synonyms, antonyms };
  }

  async addMeaning(body: AddMeaningReqDTO, manager?: EntityManager): Promise<AddMeaningResT> {
    const em = manager ?? this.enMeaningsRep.manager;
    const { word_id, id: _id, synonyms, antonyms, ...newMeaning } = body;
    const word = await em
      .getRepository(EnWord)
      .findOne({ where: { id: word_id }, relations: { word: true, base_form: { word: true } } });

    if (!word) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    const links = await this.resolveWordLinks({ synonyms, antonyms }, word.word.word, em);
    const add = async (tx: EntityManager): Promise<EnMeaning> => {
      const saved = await tx.getRepository(EnMeaning).save({ word: word, ...newMeaning, ...links });
      for (const translation of body.translations) {
        // a part of this meaning: its own row in the history would say it twice
        await this.enMeaningTranslationService.addMeaningTranslation(
          { meaning_id: saved.id, ...translation },
          tx,
        );
      }
      // inside addWord's transaction the word's own row holds the meaning
      if (manager) {
        await markEntryUserModified(tx, word.word.word);
        return saved;
      }
      const created = await tx.getRepository(EnMeaning).findOneOrFail({
        where: { id: saved.id },
        relations: { translations: true, synonyms: true, antonyms: true },
      });
      await recordChange(tx, {
        ...articleOf(word),
        entity: ChangeEntityE.meaning,
        action: ChangeActionE.create,
        record: meaningRecord(created),
        diff: createdFields(meaningSnapshot(created, true)),
      });
      return saved;
    };
    const res = manager ? await add(manager) : await em.transaction(add);
    this.logger.log(`Meaning added to word id=${word_id}, id=${res.id}`);

    return { success: true, id: res.id };
  }

  async editMeaning(body: EditMeaningReqDTO): Promise<EditMeaningResT> {
    const meaning = await this.enMeaningsRep.findOne({
      where: { id: body.id },
      relations: { synonyms: true, antonyms: true, word: { word: true, base_form: { word: true } } },
    });

    if (!meaning) {
      throw new NotFoundException(ErrorCodes.word_doesnt_found);
    }

    const valuesBefore = meaningSnapshot(meaning);
    const recordBefore = meaningRecord(meaning);
    if (body.title && body.title !== meaning.title) meaning.title = body.title;
    if (body.definition && body.definition !== meaning.definition) meaning.definition = body.definition;
    if (body.sort_order && body.sort_order !== meaning.sort_order) meaning.sort_order = body.sort_order;
    if (body.meaning_level && body.meaning_level !== meaning.meaning_level)
      meaning.meaning_level = body.meaning_level;
    // null clears the register; a body that does not name it leaves it as it is
    // (the card sends the links alone when a synonym is added)
    if (body.language_register !== undefined && body.language_register !== meaning.language_register)
      meaning.language_register = body.language_register;
    if (body.area_variant && body.area_variant !== meaning.area_variant)
      meaning.area_variant = body.area_variant;
    // examples is a nullable column: rows imported without examples hold NULL
    if (body.examples && body.examples.join() !== meaning.examples?.join()) meaning.examples = body.examples;
    if (body.categories && body.categories.join() !== meaning.categories?.join())
      meaning.categories = body.categories;
    // synonyms / antonyms replace the whole set; TypeORM diffs the junction rows on save
    const headword = meaning.word.word.word;
    for (const kind of WORD_LINK_KINDS) {
      const next = body[kind];
      if (!next) continue;
      const current = normalizeWordLinks(meaning[kind].map((e) => e.word));
      if (current.join() !== normalizeWordLinks(next, headword).join()) {
        meaning[kind] = await this.resolveLinkedEntries(kind, next, headword);
      }
    }
    assertNoSynonymAntonymConflict(meaning.synonyms, meaning.antonyms, headword, this.logger);

    await this.enMeaningsRep.manager.transaction(async (em) => {
      await em.getRepository(EnMeaning).save(meaning);
      // the history holds what the database holds after the edit, read back:
      // not what the object in memory was given
      const saved = await em.getRepository(EnMeaning).findOneOrFail({
        where: { id: meaning.id },
        relations: { synonyms: true, antonyms: true },
      });
      await recordChange(em, {
        ...articleOf(meaning.word),
        entity: ChangeEntityE.meaning,
        action: ChangeActionE.update,
        record: recordBefore,
        diff: changedFields(valuesBefore, meaningSnapshot(saved)),
      });
    });
    this.logger.log(`Meaning updated, id=${body.id}`);
    return { success: true };
  }

  async deleteMeaning(id: number): Promise<DeleteMeaningResT> {
    // loaded first only for the journal: the headword survives the delete
    // …and for the history: what is deleted is read before it is gone
    const meaning = await this.enMeaningsRep.findOne({
      where: { id },
      relations: {
        word: { word: true, base_form: { word: true } },
        translations: true,
        synonyms: true,
        antonyms: true,
      },
    });
    await this.enMeaningsRep.manager.transaction(async (em) => {
      await em.getRepository(EnMeaning).delete({ id });
      if (!meaning) return;
      await recordChange(em, {
        ...articleOf(meaning.word),
        entity: ChangeEntityE.meaning,
        action: ChangeActionE.delete,
        record: meaningRecord(meaning),
        diff: deletedFields(meaningSnapshot(meaning, true)),
      });
    });

    this.logger.log(`Meaning deleted, id=${id}`);

    return { success: true };
  }
}
