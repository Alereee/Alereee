"""The client against the real server (the fixture of conftest.py)."""

from __future__ import annotations

import httpx
import pytest

from vocab_bloom_hub import (
    AsyncVocabBloomClient,
    NetworkError,
    NotFoundError,
    TranslationLanguage,
    VocabBloomClient,
    VocabBloomError,
)


@pytest.fixture(scope="module")
def client(server_url: str) -> VocabBloomClient:
    return VocabBloomClient(server_url, cache=True)


def test_suggest_files_a_report(client: VocabBloomClient) -> None:
    created = client.suggest("run", message="The example sentence sounds unnatural - SDK live test.")
    assert created.data.id > 0
    assert created.data.status == "new"


def test_search_flat_and_detailed(client: VocabBloomClient) -> None:
    flat = client.search("run")
    assert (flat.meta.fuzzy, flat.meta.short_term, flat.meta.count) == (False, False, len(flat.data))
    assert "run" in [w.word for w in flat.data]

    detailed = client.search_detailed("run", with_meanings=True, with_translations=True, limit=5)
    assert (detailed.meta.page, detailed.meta.limit, detailed.meta.fuzzy) == (1, 5, False)
    run = next(w for w in detailed.data if w.word == "run")
    assert run.meanings[0].title == "to move fast"
    assert run.meanings[0].synonyms == ["sprint"]
    assert run.short_translations[0].language.value == "ru"


def test_headword_reads_and_by_id(client: VocabBloomClient) -> None:
    headword = client.word("run")
    assert (headword.meta.word, headword.meta.count) == ("run", 1)
    assert [f.word for f in headword.data[0].forms] == ["ran"]
    run_id = headword.data[0].id
    assert isinstance(run_id, int)

    assert client.word("ran").data[0].word == "run"  # an inflected form resolves to its base entry

    # the batch lookup answers the same entries per spelling (issue #397)
    batch = client.words_batch(["ran", "nope", "sprint"])
    assert (batch.meta.count, batch.meta.not_found) == (2, ["nope"])
    assert [(i.word, i.count, i.entries[0].word) for i in batch.data] == [
        ("ran", 1, "run"),
        ("sprint", 1, "sprint"),
    ]
    assert batch.data[0].entries == headword.data

    # the thesaurus reads (issue #403) and the prefix filter of the list
    assert [link.word for link in client.synonyms("run").data] == ["sprint"]
    assert client.antonyms("run").data == []
    assert [w.word for w in client.words(search="RU").data] == ["run"]

    # per-request options (issue #408): extra headers and a timeout for one call
    assert client.word("run", options={"headers": {"X-Request": "1"}, "timeout": 5.0}).meta.word == "run"

    meaning = client.meanings("run").data[0]
    assert (meaning.title, meaning.word_id, meaning.part_of_speech.value) == ("to move fast", run_id, "verb")

    translations = client.translations("run", language=["ru"])
    assert len(translations.data.short_translations) == 1
    assert translations.data.meaning_translations[0].meaning_id > 0

    # the history of edits (issue #531): the fixture words were added on the instance
    history = client.history("ran")
    assert (history.meta.word, history.meta.count) == ("ran", 1)
    change = history.data[0]
    assert (change.entity.value, change.action.value, change.origin.value) == ("word", "create", "admin")
    assert (change.part_of_speech, change.record, change.author) == ("verb", None, None)
    assert change.diff is not None
    assert (change.diff["transcription"].before, change.diff["transcription"].after) == (None, "/rʌn/")

    forms = client.forms("run")
    assert [(f.word, f.form_of_word.value, f.word_id) for f in forms.data] == [("ran", "past_simple", run_id)]
    # a part of an entry carries the mark of the entry, and so does a search item (issue #531)
    assert forms.data[0].modified is True
    assert client.search("run").data[0].modified is True
    # …and names where the data comes from, like the whole entry and the edits of it (issue #527)
    assert forms.data[0].source == "vocab-bloom-hub"
    assert client.search("run").data[0].source == "vocab-bloom-hub"
    assert change.source == "vocab-bloom-hub"
    assert client.meta().data.modified_entries == 3

    assert client.word_by_id(run_id).data.word == "run"


def test_list_filters_and_cursor(client: VocabBloomClient) -> None:
    page = client.words(limit=2)
    assert [w.word for w in page.data] == ["abandon", "run"]
    assert page.meta.has_more is True
    assert page.meta.next_cursor
    rest = client.words(limit=2, cursor=page.meta.next_cursor)
    assert [w.word for w in rest.data] == ["sprint"]

    assert [w.word for w in client.iter_words(limit=1, part_of_speech=["verb"])] == [
        "abandon",
        "run",
        "sprint",
    ]
    assert [w.word for w in client.words(word_level=["A1", "C1"]).data] == ["abandon", "run"]


def test_random_meta_openapi(client: VocabBloomClient) -> None:
    assert client.random(word_level=["A1"]).data.word == "run"
    meta = client.meta().data
    assert (meta.api_version, meta.license, meta.counts.words) == ("1", "CC-BY-4.0", 3)
    assert meta.available_languages.source == ["en"]
    assert meta.available_languages.translations == [
        TranslationLanguage.ru,
        TranslationLanguage.es,
        TranslationLanguage.fr,
        TranslationLanguage.de,
        TranslationLanguage.pt,
        TranslationLanguage.zh,
        TranslationLanguage.ar,
    ]
    document = client.openapi()
    assert str(document["openapi"]).startswith("3.")
    assert "/api/v1/words/{word}" in document["paths"]


def test_errors_and_etag_revalidation(server_url: str, client: VocabBloomClient) -> None:
    with pytest.raises(NotFoundError):
        client.word("nonexistent")
    with pytest.raises(NotFoundError) as none:
        client.random(word_level=["B2"])
    assert none.value.code == "word_doesnt_found"
    with pytest.raises(VocabBloomError) as bad:
        client.words(cursor="garbage")
    assert (bad.value.status, bad.value.code) == (400, "invalid_cursor")

    statuses: list[int] = []

    class Spy(httpx.HTTPTransport):
        def handle_request(self, request: httpx.Request) -> httpx.Response:
            response = super().handle_request(request)
            statuses.append(response.status_code)
            return response

    spying = VocabBloomClient(server_url, cache=True, transport=Spy())
    first = spying.words(limit=1)
    second = spying.words(limit=1)
    assert statuses == [200, 304]
    assert second == first


def test_dead_host_is_a_network_error() -> None:
    with pytest.raises(NetworkError):
        VocabBloomClient("http://127.0.0.1:1", timeout=2.0).meta()


async def test_async_client(server_url: str) -> None:
    async with AsyncVocabBloomClient(server_url, cache=True) as client:
        flat = await client.search("run")
        assert "run" in [w.word for w in flat.data]
        headword = await client.word("run")
        assert headword.meta.count == 1
        assert (await client.words_batch(["run", "nope"])).meta.not_found == ["nope"]
        assert [w.word async for w in client.iter_words(limit=1)] == ["abandon", "run", "sprint"]
        assert (await client.random(word_level=["A1"])).data.word == "run"
        assert (await client.meta()).data.counts.words == 3
        with pytest.raises(NotFoundError):
            await client.word("nonexistent")


def test_words_dataframe(client: VocabBloomClient) -> None:
    pandas = pytest.importorskip("pandas")
    frame = client.words_dataframe(with_meanings=True)
    assert isinstance(frame, pandas.DataFrame)
    assert list(frame["word"]) == ["abandon", "run", "sprint"]
    assert frame.loc[frame["word"] == "run", "meanings"].iloc[0][0]["title"] == "to move fast"
