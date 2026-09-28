import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { DictionaryLastModifiedService } from './dictionary-last-modified.service';
import { DatasetsLastModifiedService } from './datasets-last-modified.service';
import { getPublicApiCacheMaxAge } from '../../core/utils/public-api';
import { publicCacheControl, weakEtagOf } from '../../core/utils/http-cache';

/**
 * Caching headers of the public GET reads (issue #274): `Cache-Control:
 * public, max-age=<PUBLIC_API_CACHE_MAX_AGE>, stale-while-revalidate=<the same>`, a weak `ETag` hashed from
 * the JSON body and `Last-Modified` from the dictionary's newest change.
 * Express compares them with `If-None-Match` / `If-Modified-Since` while
 * sending and answers `304 Not Modified` without a body when they match.
 * `HEAD` gets the same headers: Express answers it with the `GET` handler,
 * and a cache that checks freshness with `HEAD` must see the validators of
 * the `GET` it stored. POST requests (the batch lookup, a suggestion) are
 * left alone: HTTP caches do not store them.
 */
abstract class CacheHeadersInterceptor implements NestInterceptor {
  /** When what the route answers from last changed */
  protected abstract lastModified(): Promise<Date | null>;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next.handle();
    }
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        const lastModified = await this.lastModified();
        res.setHeader('Cache-Control', publicCacheControl(getPublicApiCacheMaxAge()));
        // the same string Express is about to send (res.json → JSON.stringify)
        res.setHeader('ETag', weakEtagOf(JSON.stringify(body)));
        if (lastModified) {
          res.setHeader('Last-Modified', lastModified.toUTCString());
        }
        return body;
      }),
    );
  }
}

@Injectable()
export class PublicCacheInterceptor extends CacheHeadersInterceptor {
  constructor(private readonly lastModifiedService: DictionaryLastModifiedService) {
    super();
  }

  protected lastModified(): Promise<Date | null> {
    return this.lastModifiedService.getLastModified();
  }
}

/**
 * The same headers for the reads that answer from every dataset of the
 * instance (issue #528): their `Last-Modified` is the newest change of any
 * dataset, not of the served one
 */
@Injectable()
export class PublicDatasetsCacheInterceptor extends CacheHeadersInterceptor {
  constructor(private readonly lastModifiedService: DatasetsLastModifiedService) {
    super();
  }

  protected lastModified(): Promise<Date | null> {
    return this.lastModifiedService.getLastModified();
  }
}
