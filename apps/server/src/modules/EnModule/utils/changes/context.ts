import { AsyncLocalStorage } from 'node:async_hooks';
import { ChangeOriginE } from '../../../../../types';

/**
 * Where the edits being made come from (issue #531). An applied correction
 * of a reader and a change taken back go through the same edit services as
 * a hand-made edit; what they are is said around the call, not passed
 * through every signature.
 */
export type ChangeSourceT = {
  origin: ChangeOriginE;
  suggestion_id?: number | null;
  author?: string | null;
  /** The rows the edits leave do not show in what is served: a change taken back restores, it does not modify */
  superseded?: boolean;
};

const storage = new AsyncLocalStorage<ChangeSourceT>();

export const withChangeSource = <T>(source: ChangeSourceT, work: () => Promise<T>): Promise<T> =>
  storage.run(source, work);

export const currentChangeSource = (): ChangeSourceT => storage.getStore() ?? { origin: ChangeOriginE.admin };
