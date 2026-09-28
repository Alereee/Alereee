"""The synchronous client."""

from __future__ import annotations

import time
from collections.abc import Iterable, Iterator, Mapping, Sequence
from enum import Enum
from typing import TYPE_CHECKING, Any

import httpx
from typing_extensions import Unpack

from . import models as m
from ._core import (
    DETAILED_SEARCH_MAX_PAGE,
    Core,
    ListOptions,
    ModelT,
    RequestOptions,
    RetryOptions,
    WordFilters,
    build_json,
    headword_path,
    network_error,
)
from .cache import ResponseCache

if TYPE_CHECKING:
    import pandas


class VocabBloomClient:
    """Typed client of the public read-only API.

    Every method is one endpoint and returns the ``{ data, meta }`` envelope
    the API answers with, as a pydantic model; failures raise
    :class:`~vocab_bloom_hub.VocabBloomError` (or ``NotFoundError``,
    ``RateLimitError``, ``NetworkError``). No authentication: the public
    prefix has none. Use it as a context manager to close the connection pool.

    :param base_url: origin of the instance, e.g. ``https://dict.example.com``; ``/api/v1`` is appended
    :param headers: sent with every request
    :param timeout: seconds, per request
    :param cache: ``True`` for an in-memory ETag cache, or your own :class:`ResponseCache`; off by default
    :param retry: opt-in retry of the GET reads on ``429`` / ``5xx`` honouring ``Retry-After``
        (:class:`RetryOptions`; ``{}`` means 3 attempts, 0.5 s backoff); off by default
    :param transport: a custom ``httpx`` transport (tests, instrumentation)

    Every method takes ``options=`` (:class:`RequestOptions`): ``headers`` merged over the client's
    and a ``timeout`` for that one request — the counterpart of the Node client's last argument.
    """

    def __init__(
        self,
        base_url: str,
        *,
        headers: Mapping[str, str] | None = None,
        timeout: float | httpx.Timeout = 10.0,
        cache: bool | ResponseCache = False,
        retry: RetryOptions | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._core = Core(base_url, headers, cache, retry)
        self._http = httpx.Client(timeout=timeout, transport=transport)

    # ---------------------------------------------------------- lifecycle

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> VocabBloomClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------- search

    def search(
        self,
        search: str,
        *,
        type: str | Enum | None = None,
        limit: int | None = None,
        options: RequestOptions | None = None,
    ) -> m.SearchResponse:
        """Flat search: relevance tiers, typo tolerance, no meanings joined.

        Sent as ``GET`` with the fields in the query string, so the answer carries an
        ETag and the client's cache revalidates it (issue #396).
        """
        return self._get(
            "/search", {"search": search, "type": type, "limit": limit}, m.SearchResponse, options
        )

    def search_detailed(
        self,
        search: str,
        *,
        type: str | Enum | None = None,
        limit: int | None = None,
        page: int | None = None,
        with_meanings: bool | None = None,
        with_translations: bool | None = None,
        translation_languages: Iterable[str | Enum] | None = None,
        options: RequestOptions | None = None,
    ) -> m.DetailedSearchResponse:
        """Paged search with meanings and translations on request (``GET``, cacheable)."""
        params = {
            "search": search,
            "type": type,
            "limit": limit,
            "page": page,
            "with_meanings": with_meanings,
            "with_translations": with_translations,
            "translation_languages": translation_languages,
        }
        return self._get("/search/detailed", params, m.DetailedSearchResponse, options)

    def iter_search_detailed(
        self,
        search: str,
        *,
        type: str | Enum | None = None,
        limit: int | None = None,
        page: int | None = None,
        with_meanings: bool | None = None,
        with_translations: bool | None = None,
        translation_languages: Iterable[str | Enum] | None = None,
        options: RequestOptions | None = None,
    ) -> Iterator[m.Word]:
        """Every item of the detailed search, page after page from ``page`` (1 by default) while
        ``meta.has_more`` says there is one: :meth:`iter_words` for the page-based search. The server
        serves ``DETAILED_SEARCH_MAX_PAGE`` pages at most, so a broad search ends there rather than with
        a 400; narrow it (``type``, a longer term) to see the rest."""
        current = page or 1
        while True:
            answer = self.search_detailed(
                search,
                type=type,
                limit=limit,
                page=current,
                with_meanings=with_meanings,
                with_translations=with_translations,
                translation_languages=translation_languages,
                options=options,
            )
            yield from answer.data
            current += 1
            if not answer.meta.has_more or current > DETAILED_SEARCH_MAX_PAGE:
                return

    # -------------------------------------------------------------- reads

    def word(self, headword: str, *, options: RequestOptions | None = None) -> m.HeadwordResponse:
        """All entries of a headword: parts of speech, forms, meanings, translations, links."""
        return self._get(headword_path(headword), None, m.HeadwordResponse, options)

    def words_batch(
        self, words: Sequence[str], *, options: RequestOptions | None = None
    ) -> m.WordsBatchResponse:
        """Up to 50 headwords in one request (one rate-limit unit); misses under ``meta.not_found``."""
        return self._post("/words/batch", {"words": list(words)}, m.WordsBatchResponse, options)

    def word_by_id(self, id: int, *, options: RequestOptions | None = None) -> m.WordResponse:
        """One entry by its numeric id."""
        return self._get(f"/words/id/{id}", None, m.WordResponse, options)

    def meanings(self, headword: str, *, options: RequestOptions | None = None) -> m.MeaningsResponse:
        """The meanings of every entry of a headword."""
        return self._get(headword_path(headword, "/meanings"), None, m.MeaningsResponse, options)

    def translations(
        self,
        headword: str,
        *,
        language: Iterable[str | Enum] | None = None,
        options: RequestOptions | None = None,
    ) -> m.TranslationsResponse:
        """Short and per-meaning translations of a headword, optionally limited to languages."""
        return self._get(
            headword_path(headword, "/translations"), {"language": language}, m.TranslationsResponse, options
        )

    def forms(self, headword: str, *, options: RequestOptions | None = None) -> m.FormsResponse:
        """Inflected forms of every entry of a headword."""
        return self._get(headword_path(headword, "/forms"), None, m.FormsResponse, options)

    def synonyms(self, headword: str, *, options: RequestOptions | None = None) -> m.LinksResponse:
        """The synonyms of every meaning of a headword, each naming its meaning and entry."""
        return self._get(headword_path(headword, "/synonyms"), None, m.LinksResponse, options)

    def antonyms(self, headword: str, *, options: RequestOptions | None = None) -> m.LinksResponse:
        """The antonyms of every meaning of a headword, each naming its meaning and entry."""
        return self._get(headword_path(headword, "/antonyms"), None, m.LinksResponse, options)

    def history(self, headword: str, *, options: RequestOptions | None = None) -> m.HistoryResponse:
        """What was changed or added on the instance in the entries of a headword.

        The edits that still show in what is served, the latest first, with the values
        before and after. Empty for a headword served as its source has it.
        """
        return self._get(headword_path(headword, "/history"), None, m.HistoryResponse, options)

    # --------------------------------------------------------------- list

    def words(
        self, *, options: RequestOptions | None = None, **filters: Unpack[ListOptions]
    ) -> m.WordsResponse:
        """One page of the filtered list, ordered by (word, id).

        Pass ``meta.next_cursor`` back as ``cursor`` for the next page; it is ``None`` on the last one.
        """
        return self._get("/words", filters, m.WordsResponse, options)

    def iter_words(
        self, *, options: RequestOptions | None = None, **filters: Unpack[ListOptions]
    ) -> Iterator[m.Word]:
        """Every entry matching the filters, page after page, until the last one."""
        query: dict[str, Any] = {k: v for k, v in filters.items() if k != "cursor"}
        cursor: str | None = None
        while True:
            page = self.words(**query, cursor=cursor, options=options)
            yield from page.data
            cursor = page.meta.next_cursor
            if cursor is None:
                return

    def random(
        self, *, options: RequestOptions | None = None, **filters: Unpack[WordFilters]
    ) -> m.WordResponse:
        """A random entry matching the filters."""
        return self._get("/random", filters, m.WordResponse, options)

    # --------------------------------------------------------------- meta

    def meta(self, *, options: RequestOptions | None = None) -> m.MetaResponse:
        """Versions, data license and counts of the instance."""
        return self._get("/meta", None, m.MetaResponse, options)

    def openapi(self, *, options: RequestOptions | None = None) -> dict[str, Any]:
        """The OpenAPI 3 document of the instance."""
        prepared = self._core.prepare_get("/openapi.json", None, options)
        response = self._send_get(prepared, options)
        document: dict[str, Any] = self._core.finish_get_raw(prepared, response)
        return document

    # -------------------------------------------------------- suggestions

    def suggest(
        self,
        headword: str,
        *,
        message: str | None = None,
        word_id: int | None = None,
        kind: str | Enum | None = None,
        edits: Iterable[Mapping[str, Any]] | None = None,
        options: RequestOptions | None = None,
    ) -> m.SuggestionCreatedResponse:
        """Files reader feedback into the instance's moderation queue (issue #327).

        A free-text report by default; ``kind="edit"`` with ``edits`` — a list
        of ``{"target_type", "target_id", "changes"}`` items covering every
        touched piece of the word form — proposes concrete values the admin
        can apply in one click. Strictly rate-limited per client.
        """
        body = {
            "headword": headword,
            "message": message,
            "word_id": word_id,
            "kind": kind,
            "edits": [dict(edit) for edit in edits] if edits is not None else None,
        }
        return self._post("/suggestions", body, m.SuggestionCreatedResponse, options)

    # ------------------------------------------------------------- pandas

    def words_dataframe(
        self, *, options: RequestOptions | None = None, **filters: Unpack[ListOptions]
    ) -> pandas.DataFrame:
        """The whole filtered list as a DataFrame, one row per entry (needs the ``pandas`` extra).

        Nested collections (``meanings``, ``forms``, ``short_translations``) stay as lists in their cells.
        """
        try:
            import pandas
        except ImportError as error:  # pragma: no cover - depends on the environment
            raise ImportError(
                "words_dataframe needs pandas: pip install 'vocab-bloom-hub[pandas]'"
            ) from error
        rows = [word.model_dump(mode="json") for word in self.iter_words(options=options, **filters)]
        return pandas.json_normalize(rows, max_level=0)

    # ----------------------------------------------------------- plumbing

    def _get(
        self,
        path: str,
        params: Mapping[str, Any] | None,
        model: type[ModelT],
        options: RequestOptions | None = None,
    ) -> ModelT:
        prepared = self._core.prepare_get(path, params, options)
        response = self._send_get(prepared, options)
        return self._core.finish_get(prepared, response, model)

    # The GET reads only are retried (when opted in): a POST is sent once
    def _send_get(self, prepared: Any, options: RequestOptions | None) -> httpx.Response:
        kwargs = self._core.send_kwargs(options)
        attempt = 1
        while True:
            response = self._send("GET", prepared.url, headers=prepared.headers, **kwargs)
            delay = self._core.retry_delay(response, attempt)
            if delay is None:
                return response
            time.sleep(delay)
            attempt += 1

    def _post(
        self,
        path: str,
        body: Mapping[str, Any],
        model: type[ModelT],
        options: RequestOptions | None = None,
    ) -> ModelT:
        url = self._core.base_url + path
        response = self._send(
            "POST",
            url,
            headers=self._core.request_headers(options),
            json=build_json(body),
            **self._core.send_kwargs(options),
        )
        return self._core.finish_post(response, model)

    def _send(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            return self._http.request(method, url, **kwargs)
        except httpx.HTTPError as error:
            raise network_error(url, error) from error
