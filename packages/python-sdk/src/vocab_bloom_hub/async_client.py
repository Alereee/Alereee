"""The asynchronous client (``httpx.AsyncClient``)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterable, Mapping, Sequence
from enum import Enum
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

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


class AsyncVocabBloomClient:
    """The asynchronous twin of :class:`~vocab_bloom_hub.VocabBloomClient`: the same methods, awaited.

    Use it as an async context manager (``async with``) to close the connection pool.
    """

    def __init__(
        self,
        base_url: str,
        *,
        headers: Mapping[str, str] | None = None,
        timeout: float | httpx.Timeout = 10.0,
        cache: bool | ResponseCache = False,
        retry: RetryOptions | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._core = Core(base_url, headers, cache, retry)
        self._http = httpx.AsyncClient(timeout=timeout, transport=transport)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> AsyncVocabBloomClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def search(
        self,
        search: str,
        *,
        type: str | Enum | None = None,
        limit: int | None = None,
        options: RequestOptions | None = None,
    ) -> m.SearchResponse:
        return await self._get(
            "/search", {"search": search, "type": type, "limit": limit}, m.SearchResponse, options
        )

    async def search_detailed(
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
        params = {
            "search": search,
            "type": type,
            "limit": limit,
            "page": page,
            "with_meanings": with_meanings,
            "with_translations": with_translations,
            "translation_languages": translation_languages,
        }
        return await self._get("/search/detailed", params, m.DetailedSearchResponse, options)

    async def iter_search_detailed(
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
    ) -> AsyncIterator[m.Word]:
        current = page or 1
        while True:
            answer = await self.search_detailed(
                search,
                type=type,
                limit=limit,
                page=current,
                with_meanings=with_meanings,
                with_translations=with_translations,
                translation_languages=translation_languages,
                options=options,
            )
            for word in answer.data:
                yield word
            current += 1
            if not answer.meta.has_more or current > DETAILED_SEARCH_MAX_PAGE:
                return

    async def word(self, headword: str, *, options: RequestOptions | None = None) -> m.HeadwordResponse:
        return await self._get(headword_path(headword), None, m.HeadwordResponse, options)

    async def words_batch(
        self, words: Sequence[str], *, options: RequestOptions | None = None
    ) -> m.WordsBatchResponse:
        return await self._post("/words/batch", {"words": list(words)}, m.WordsBatchResponse, options)

    async def word_by_id(self, id: int, *, options: RequestOptions | None = None) -> m.WordResponse:
        return await self._get(f"/words/id/{id}", None, m.WordResponse, options)

    async def meanings(self, headword: str, *, options: RequestOptions | None = None) -> m.MeaningsResponse:
        return await self._get(headword_path(headword, "/meanings"), None, m.MeaningsResponse, options)

    async def translations(
        self,
        headword: str,
        *,
        language: Iterable[str | Enum] | None = None,
        options: RequestOptions | None = None,
    ) -> m.TranslationsResponse:
        return await self._get(
            headword_path(headword, "/translations"), {"language": language}, m.TranslationsResponse, options
        )

    async def forms(self, headword: str, *, options: RequestOptions | None = None) -> m.FormsResponse:
        return await self._get(headword_path(headword, "/forms"), None, m.FormsResponse, options)

    async def synonyms(self, headword: str, *, options: RequestOptions | None = None) -> m.LinksResponse:
        return await self._get(headword_path(headword, "/synonyms"), None, m.LinksResponse, options)

    async def antonyms(self, headword: str, *, options: RequestOptions | None = None) -> m.LinksResponse:
        return await self._get(headword_path(headword, "/antonyms"), None, m.LinksResponse, options)

    async def history(self, headword: str, *, options: RequestOptions | None = None) -> m.HistoryResponse:
        return await self._get(headword_path(headword, "/history"), None, m.HistoryResponse, options)

    async def word_datasets(
        self, headword: str, *, options: RequestOptions | None = None
    ) -> m.WordDatasetsResponse:
        return await self._get(headword_path(headword, "/datasets"), None, m.WordDatasetsResponse, options)

    async def dataset_history(
        self, headword: str, dataset: str, *, options: RequestOptions | None = None
    ) -> m.HistoryResponse:
        path = headword_path(headword, f"/datasets/{quote(dataset, safe='')}/history")
        return await self._get(path, None, m.HistoryResponse, options)

    async def words(
        self, *, options: RequestOptions | None = None, **filters: Unpack[ListOptions]
    ) -> m.WordsResponse:
        return await self._get("/words", filters, m.WordsResponse, options)

    async def iter_words(
        self, *, options: RequestOptions | None = None, **filters: Unpack[ListOptions]
    ) -> AsyncIterator[m.Word]:
        query: dict[str, Any] = {k: v for k, v in filters.items() if k != "cursor"}
        cursor: str | None = None
        while True:
            page = await self.words(**query, cursor=cursor, options=options)
            for word in page.data:
                yield word
            cursor = page.meta.next_cursor
            if cursor is None:
                return

    async def random(
        self, *, options: RequestOptions | None = None, **filters: Unpack[WordFilters]
    ) -> m.WordResponse:
        return await self._get("/random", filters, m.WordResponse, options)

    async def meta(self, *, options: RequestOptions | None = None) -> m.MetaResponse:
        return await self._get("/meta", None, m.MetaResponse, options)

    async def openapi(self, *, options: RequestOptions | None = None) -> dict[str, Any]:
        prepared = self._core.prepare_get("/openapi.json", None, options)
        response = await self._send_get(prepared, options)
        document: dict[str, Any] = self._core.finish_get_raw(prepared, response)
        return document

    async def suggest(
        self,
        headword: str,
        *,
        message: str | None = None,
        word_id: int | None = None,
        kind: str | Enum | None = None,
        edits: Iterable[Mapping[str, Any]] | None = None,
        options: RequestOptions | None = None,
    ) -> m.SuggestionCreatedResponse:
        """Files reader feedback into the instance's moderation queue (issue #327)."""
        body = {
            "headword": headword,
            "message": message,
            "word_id": word_id,
            "kind": kind,
            "edits": [dict(edit) for edit in edits] if edits is not None else None,
        }
        return await self._post("/suggestions", body, m.SuggestionCreatedResponse, options)

    async def words_dataframe(
        self, *, options: RequestOptions | None = None, **filters: Unpack[ListOptions]
    ) -> pandas.DataFrame:
        """The whole filtered list as a DataFrame, one row per entry (needs the ``pandas`` extra)."""
        try:
            import pandas
        except ImportError as error:  # pragma: no cover - depends on the environment
            raise ImportError(
                "words_dataframe needs pandas: pip install 'vocab-bloom-hub[pandas]'"
            ) from error
        rows = [word.model_dump(mode="json") async for word in self.iter_words(options=options, **filters)]
        return pandas.json_normalize(rows, max_level=0)

    async def _get(
        self,
        path: str,
        params: Mapping[str, Any] | None,
        model: type[ModelT],
        options: RequestOptions | None = None,
    ) -> ModelT:
        prepared = self._core.prepare_get(path, params, options)
        response = await self._send_get(prepared, options)
        return self._core.finish_get(prepared, response, model)

    # The GET reads only are retried (when opted in): a POST is sent once
    async def _send_get(self, prepared: Any, options: RequestOptions | None) -> httpx.Response:
        kwargs = self._core.send_kwargs(options)
        attempt = 1
        while True:
            response = await self._send("GET", prepared.url, headers=prepared.headers, **kwargs)
            delay = self._core.retry_delay(response, attempt)
            if delay is None:
                return response
            await asyncio.sleep(delay)
            attempt += 1

    async def _post(
        self,
        path: str,
        body: Mapping[str, Any],
        model: type[ModelT],
        options: RequestOptions | None = None,
    ) -> ModelT:
        url = self._core.base_url + path
        response = await self._send(
            "POST",
            url,
            headers=self._core.request_headers(options),
            json=build_json(body),
            **self._core.send_kwargs(options),
        )
        return self._core.finish_post(response, model)

    async def _send(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            return await self._http.request(method, url, **kwargs)
        except httpx.HTTPError as error:
            raise network_error(url, error) from error
