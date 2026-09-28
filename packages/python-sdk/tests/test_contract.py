"""Every operation of the public spec has a client method (sync and async)."""

from __future__ import annotations

import json
from pathlib import Path

from vocab_bloom_hub import DETAILED_SEARCH_MAX_PAGE, AsyncVocabBloomClient, VocabBloomClient

SPEC = Path(__file__).resolve().parents[3] / "apps" / "server" / "openapi" / "public-v1.json"

METHOD_BY_OPERATION = {
    # the searches are GET reads (issue #396); their POST forms were removed (issue #440)
    "PublicSearchController_searchGet": "search",
    "PublicSearchController_searchDetailedGet": "search_detailed",
    "PublicWordsController_list": "words",
    "PublicWordsController_byId": "word_by_id",
    "PublicWordsController_byHeadword": "word",
    "PublicWordsController_batch": "words_batch",
    "PublicWordsController_meanings": "meanings",
    "PublicWordsController_translations": "translations",
    "PublicWordsController_forms": "forms",
    "PublicWordsController_synonyms": "synonyms",
    "PublicWordsController_antonyms": "antonyms",
    "PublicWordsController_history": "history",
    "PublicDictionaryController_random": "random",
    "PublicDictionaryController_meta": "meta",
    "PublicOpenApiController_openapi": "openapi",
    "PublicSuggestionsController_create": "suggest",
}


def test_every_operation_has_a_method() -> None:
    spec = json.loads(SPEC.read_text())
    operations = sorted(op["operationId"] for item in spec["paths"].values() for op in item.values())
    assert operations == sorted(METHOD_BY_OPERATION)
    for method in METHOD_BY_OPERATION.values():
        assert callable(getattr(VocabBloomClient, method))
        assert callable(getattr(AsyncVocabBloomClient, method))


def test_page_iterator_stops_at_the_documented_cap() -> None:
    spec = json.loads(SPEC.read_text())
    page = next(
        p for p in spec["paths"]["/api/v1/search/detailed"]["get"]["parameters"] if p["name"] == "page"
    )
    assert page["schema"]["maximum"] == DETAILED_SEARCH_MAX_PAGE
