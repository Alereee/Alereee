# Generated from apps/server/openapi/public-v1.json by scripts/generate_models.py — do not edit.
# ruff: noqa
# mypy: ignore-errors

from __future__ import annotations

from enum import Enum
from pydantic import BaseModel, Field
from typing import Any


class TargetType(Enum):
    word = "word"
    meaning = "meaning"
    meaning_translation = "meaning_translation"
    short_translation = "short_translation"


class SuggestionEditV1DTO(BaseModel):
    target_type: TargetType
    target_id: float = Field(..., description="Id of the targeted row, from the word answers")
    changes: dict[str, Any] = Field(
        ...,
        description='The proposed field values, e.g. { "definition": "…" }. The accepted fields depend on target_type; unknown fields, empty values and values equal to the current ones are rejected',
    )


class Kind(Enum):
    report = "report"
    edit = "edit"


class CreateSuggestionV1ReqDTO(BaseModel):
    headword: str = Field(..., description="The headword the report is about; must exist in the dictionary")
    word_id: dict[str, Any] | None = Field(
        None, description="Id of the entry (part of speech) the report points at, from the word answers"
    )
    kind: Kind = "report"
    message: dict[str, Any] | None = Field(
        None,
        description="What is wrong and, ideally, what would be right. Required for a report; an optional comment on an edit",
    )
    edits: list[SuggestionEditV1DTO] | None = Field(
        None, description="Edit flow: every touched target of the word form with its proposed values"
    )
    author_name: dict[str, Any] | None = Field(
        None,
        description="The name the sender wants to be credited by (issue #531). Kept only together with `author_consent: true`: once the correction is applied the name is shown next to it and travels with the copies of the data",
    )
    author_consent: dict[str, Any] | None = Field(
        None,
        description="The sender agrees that `author_name` is shown and exported; required when a name is given",
    )


class WordsBatchV1ReqDTO(BaseModel):
    words: list[str] = Field(
        ...,
        description="Headword spellings, 50 at most, each matched like GET /words/{word} (case-insensitively; an inflected form resolves to its base entry)",
        examples=[["run", "ran", "put up with"]],
        max_length=50,
        min_length=1,
    )


class PublicSearchV1MetaT(BaseModel):
    count: int
    fuzzy: bool
    short_term: bool


class EnPartOfSpeechE(Enum):
    noun = "noun"
    verb = "verb"
    modal_verb = "modal_verb"
    adjective = "adjective"
    adverb = "adverb"
    pronoun = "pronoun"
    numeral = "numeral"
    numeral_fractional = "numeral_fractional"
    determiner = "determiner"
    interjection = "interjection"
    article = "article"
    preposition = "preposition"
    conjunction = "conjunction"
    letter = "letter"
    phrase = "phrase"
    grammar_pattern = "grammar_pattern"


class EnWordFormsE(Enum):
    base_form = "base_form"
    plural_form = "plural_form"
    possessive_singular_form = "possessive_singular_form"
    possessive_plural_form = "possessive_plural_form"
    past_simple = "past_simple"
    past_participle = "past_participle"
    present_participle = "present_participle"
    third_person_singular = "third_person_singular"
    comparative_form = "comparative_form"
    superlative_form = "superlative_form"
    object = "object"
    possessive_adjective = "possessive_adjective"
    possessive_pronoun = "possessive_pronoun"
    reflexive = "reflexive"
    ordinal = "ordinal"
    multiplicative = "multiplicative"


class WordLevelE(Enum):
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"


class EnAreaVariantsE(Enum):
    common = "common"
    british = "british"
    american = "american"
    australian = "australian"


class CategoryE(Enum):
    scientific = "scientific"
    technical = "technical"
    medical = "medical"
    legal = "legal"
    business = "business"
    IT = "IT"
    art = "art"
    political = "political"
    sport = "sport"
    culinary = "culinary"


class LanguageRegisterE(Enum):
    formal = "formal"
    informal = "informal"
    slang = "slang"


class EnVerbTransitivityE(Enum):
    transitive = "transitive"
    intransitive = "intransitive"
    both = "both"


class EnPhrasalObjectPatternE(Enum):
    no_object = "no_object"
    inseparable = "inseparable"
    separable = "separable"
    separable_pronoun_only = "separable_pronoun_only"


class PublicWordV1FormT(BaseModel):
    id: int
    word: str
    form_of_word: EnWordFormsE
    area_variant: EnAreaVariantsE
    transcription: str | None = Field(...)


class PublicSearchDetailedV1MetaT(BaseModel):
    page: int
    limit: int
    has_more: bool
    fuzzy: bool
    short_term: bool


class AvailableTranslationLanguagesE(Enum):
    ru = "ru"
    es = "es"
    fr = "fr"
    de = "de"
    pt = "pt"
    zh = "zh"
    ar = "ar"


class PublicWordV1ShortTranslationT(BaseModel):
    id: int
    language: AvailableTranslationLanguagesE
    description: str
    variants_of_words: list[str]


class PublicHeadwordV1MetaT(BaseModel):
    word: str
    count: int
    variants: list[str] | None = None


class PublicWordFormV1T(BaseModel):
    word_id: int
    part_of_speech: EnPartOfSpeechE
    source: str | None = None
    modified: bool | None = None
    id: int
    word: str
    form_of_word: EnWordFormsE
    area_variant: EnAreaVariantsE
    transcription: str | None = Field(...)


class PublicHeadwordFormsV1ResT(BaseModel):
    data: list[PublicWordFormV1T]
    meta: PublicHeadwordV1MetaT


class PublicShortTranslationV1T(BaseModel):
    word_id: int
    part_of_speech: EnPartOfSpeechE
    source: str | None = None
    modified: bool | None = None
    id: int
    language: AvailableTranslationLanguagesE
    description: str
    variants_of_words: list[str]


class PublicMeaningTranslationV1T(BaseModel):
    meaning_id: int
    word_id: int
    part_of_speech: EnPartOfSpeechE
    source: str | None = None
    modified: bool | None = None
    id: int
    language: AvailableTranslationLanguagesE
    title: str
    definition: str
    variants_of_words: list[str]


class PublicWordLinkV1T(BaseModel):
    meaning_id: int
    word: str
    word_id: int
    part_of_speech: EnPartOfSpeechE
    source: str | None = None
    modified: bool | None = None


class PublicHeadwordLinksV1ResT(BaseModel):
    data: list[PublicWordLinkV1T]
    meta: PublicHeadwordV1MetaT


class ChangeEntityE(Enum):
    """
    What was edited
    """

    word = "word"
    word_form = "word_form"
    meaning = "meaning"
    meaning_translation = "meaning_translation"
    short_translation = "short_translation"


class ChangeActionE(Enum):
    create = "create"
    update = "update"
    delete = "delete"


class ChangeFormRecordT(BaseModel):
    word: str
    form_of_word: str


class ChangeMeaningRecordT(BaseModel):
    title: str
    sort_order: int


class ChangeTranslationRecordT(BaseModel):
    meaning: ChangeMeaningRecordT
    language: str
    title: str


class ChangeShortTranslationRecordT(BaseModel):
    language: str
    description: str


class ChangeDiffT1(BaseModel):
    before: Any
    after: Any


class ChangeOriginE(Enum):
    """
    Where an edit came from
    """

    admin = "admin"
    suggestion = "suggestion"
    revert = "revert"


class PublicHeadwordHistoryV1MetaT(BaseModel):
    word: str
    count: int
    variants: list[str] | None = None


class PublicHeadwordTranslationsV1T(BaseModel):
    short_translations: list[PublicShortTranslationV1T]
    meaning_translations: list[PublicMeaningTranslationV1T]


class PublicHeadwordTranslationsV1ResT(BaseModel):
    meta: PublicHeadwordV1MetaT
    data: PublicHeadwordTranslationsV1T


class PublicWordsBatchV1MetaT(BaseModel):
    count: int
    not_found: list[str]


class PublicWordsV1MetaT(BaseModel):
    limit: int
    has_more: bool
    next_cursor: str | None = Field(...)


class PublicDatasetCountsV1T(BaseModel):
    entries: int
    words: int
    phrases: int
    grammar_patterns: int
    word_forms: int
    meanings: int
    meaning_translations: int
    short_translations: int


class PublicAvailableLanguagesV1T(BaseModel):
    source: list[str]
    translations: list[AvailableTranslationLanguagesE]


class PublicSuggestionCreatedV1T(BaseModel):
    id: int
    status: str


class PublicSuggestionCreatedV1ResT(BaseModel):
    data: PublicSuggestionCreatedV1T


class PublicApiErrorT(BaseModel):
    statusCode: float
    message: str
    error: bool


class PublicSearchWordV1T(BaseModel):
    id: int
    word: str
    part_of_speech: EnPartOfSpeechE
    form_of_word: EnWordFormsE
    is_obsolete: bool
    is_abbreviation: bool
    word_level: WordLevelE | None = Field(...)
    area_variant: EnAreaVariantsE | None = Field(...)
    categories: list[CategoryE]
    language_register: LanguageRegisterE | None = Field(...)
    description: str | None = Field(...)
    transcription: str | None = Field(...)
    pattern: list[str] | None = Field(...)
    noun___irregular_plural: bool | None = Field(...)
    noun___uncountable: bool | None = Field(...)
    noun___is_proper: bool | None = Field(...)
    noun___always_plural: bool | None = Field(...)
    verb___is_irregular: bool | None = Field(...)
    verb___transitivity: EnVerbTransitivityE | None = Field(...)
    verb___is_phrasal: bool | None = Field(...)
    verb___phrasal_object_pattern: EnPhrasalObjectPatternE | None = Field(...)
    base_phrasal: str | None = Field(...)
    forms: list[PublicWordV1FormT]
    similarity: float | None = None
    source: str | None = None
    modified: bool | None = None


class PublicWordV1MeaningTranslationT(BaseModel):
    id: int
    language: AvailableTranslationLanguagesE
    title: str
    definition: str
    variants_of_words: list[str]


class PublicMeaningV1T(BaseModel):
    word_id: int
    part_of_speech: EnPartOfSpeechE
    source: str | None = None
    modified: bool | None = None
    id: int
    sort_order: int
    title: str
    definition: str
    is_obsolete: bool
    examples: list[str]
    categories: list[CategoryE]
    meaning_level: WordLevelE | None = Field(...)
    area_variant: EnAreaVariantsE
    language_register: LanguageRegisterE | None = Field(...)
    translations: list[PublicWordV1MeaningTranslationT]
    synonyms: list[str]
    antonyms: list[str]


class PublicHeadwordMeaningsV1ResT(BaseModel):
    data: list[PublicMeaningV1T]
    meta: PublicHeadwordV1MetaT


class PublicMetaV1T(BaseModel):
    api_version: str
    app_version: str
    dataset_version: str | None = Field(...)
    license: str
    license_url: str
    attribution: str
    notice: str
    dataset: str | None = None
    source: str | None = None
    attribution_url: str | None = None
    license_text: str | None = None
    modified_entries: int | None = None
    counts: PublicDatasetCountsV1T
    available_languages: PublicAvailableLanguagesV1T


class PublicMetaV1ResT(BaseModel):
    data: PublicMetaV1T


class PublicSearchV1ResT(BaseModel):
    data: list[PublicSearchWordV1T]
    meta: PublicSearchV1MetaT


class PublicWordV1MeaningT(BaseModel):
    id: int
    sort_order: int
    title: str
    definition: str
    is_obsolete: bool
    examples: list[str]
    categories: list[CategoryE]
    meaning_level: WordLevelE | None = Field(...)
    area_variant: EnAreaVariantsE
    language_register: LanguageRegisterE | None = Field(...)
    translations: list[PublicWordV1MeaningTranslationT]
    synonyms: list[str]
    antonyms: list[str]


class PublicChangeV1T(BaseModel):
    created_at: str
    word: str
    part_of_speech: str | None = Field(...)
    entity: ChangeEntityE
    action: ChangeActionE
    record: (
        ChangeFormRecordT
        | ChangeMeaningRecordT
        | ChangeTranslationRecordT
        | ChangeShortTranslationRecordT
        | None
    ) = Field(
        ...,
        description="The record of an entry an edit is about, by what it says rather than by its id: ids change when a dataset is updated and differ between instances. Null for the word itself — the headword and the part of speech name it.",
    )
    diff: dict[str, ChangeDiffT1]
    origin: ChangeOriginE
    author: str | None = Field(...)
    source: str | None = None


class PublicHeadwordHistoryV1ResT(BaseModel):
    data: list[PublicChangeV1T]
    meta: PublicHeadwordHistoryV1MetaT


class PublicWordV1T(BaseModel):
    meanings: list[PublicWordV1MeaningT]
    short_translations: list[PublicWordV1ShortTranslationT]
    phrasal_variants: list[str] | None = None
    id: int
    word: str
    part_of_speech: EnPartOfSpeechE
    form_of_word: EnWordFormsE
    is_obsolete: bool
    is_abbreviation: bool
    word_level: WordLevelE | None = Field(...)
    area_variant: EnAreaVariantsE | None = Field(...)
    categories: list[CategoryE]
    language_register: LanguageRegisterE | None = Field(...)
    description: str | None = Field(...)
    transcription: str | None = Field(...)
    pattern: list[str] | None = Field(...)
    noun___irregular_plural: bool | None = Field(...)
    noun___uncountable: bool | None = Field(...)
    noun___is_proper: bool | None = Field(...)
    noun___always_plural: bool | None = Field(...)
    verb___is_irregular: bool | None = Field(...)
    verb___transitivity: EnVerbTransitivityE | None = Field(...)
    verb___is_phrasal: bool | None = Field(...)
    verb___phrasal_object_pattern: EnPhrasalObjectPatternE | None = Field(...)
    base_phrasal: str | None = Field(...)
    forms: list[PublicWordV1FormT]
    similarity: float | None = None
    source: str | None = None
    modified: bool | None = None


class PublicWordV1ResT(BaseModel):
    data: PublicWordV1T


class PublicHeadwordV1ResT(BaseModel):
    data: list[PublicWordV1T]
    meta: PublicHeadwordV1MetaT


class PublicWordsBatchItemV1T(BaseModel):
    word: str
    count: int
    entries: list[PublicWordV1T]


class PublicWordsBatchV1ResT(BaseModel):
    data: list[PublicWordsBatchItemV1T]
    meta: PublicWordsBatchV1MetaT


class PublicWordsV1ResT(BaseModel):
    data: list[PublicWordV1T]
    meta: PublicWordsV1MetaT


class PublicSearchDetailedV1ResT(BaseModel):
    data: list[PublicWordV1T]
    meta: PublicSearchDetailedV1MetaT
