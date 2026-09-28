import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import { ChangeActionE, ChangeEntityE, ChangeOriginE, ChangeT } from 'server/types';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
}));

jest.mock('@/core/api/EnApi', () => ({
  EnApi: {
    getChanges: jest.fn(),
    revertChange: jest.fn(),
    forgetChangeAuthor: jest.fn(),
  },
}));

import { EnApi } from '@/core/api/EnApi';
import { ChangesHistory, ForgetAuthor } from '../index';
import { recordName, shortValue, shownFields } from '../utils';

const change = (over: Partial<ChangeT> = {}): ChangeT => ({
  id: 1,
  created_at: '2026-09-27T10:00:00.000Z',
  headword: 'lamp',
  part_of_speech: 'noun',
  entity: ChangeEntityE.word,
  action: ChangeActionE.update,
  record: null,
  diff: { description: { before: 'the word lamp', after: 'a device that produces light' } },
  origin: ChangeOriginE.admin,
  suggestion_id: null,
  author: null,
  superseded_at: null,
  revertible: true,
  ...over,
});

const listOf = (items: ChangeT[]) => ({ items, total: items.length, page: 1, limit: 25, has_more: false });

const renderHistory = (props: React.ComponentProps<typeof ChangesHistory> = {}) =>
  render(
    <App>
      <ChangesHistory {...props} />
    </App>,
  );

// The history of edits in the admin UI (issue #531)
describe('ChangesHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows what was changed, where it came from and whether it still shows', async () => {
    (EnApi.getChanges as jest.Mock).mockResolvedValue(
      listOf([
        change({
          id: 3,
          entity: ChangeEntityE.meaning,
          record: { title: 'a light', sort_order: 1 },
          origin: ChangeOriginE.suggestion,
          author: 'Ada',
          diff: { definition: { before: 'A light.', after: 'A device that gives light.' } },
        }),
        change({ id: 2, superseded_at: '2026-09-28T10:00:00.000Z', revertible: false }),
        change({
          id: 1,
          origin: ChangeOriginE.revert,
          superseded_at: '2026-09-27T11:00:00.000Z',
          revertible: false,
        }),
      ]),
    );

    renderHistory();

    await screen.findByTestId('revert-3');
    const rows = screen.getAllByRole('row');
    // the header and the three changes
    expect(rows).toHaveLength(4);
    const [, reader, replaced, takenBack] = rows.map((row) => within(row));
    expect(reader.getByText('entity_meaning', { exact: false })).toBeTruthy();
    // the history of the whole dataset names the word of every row
    expect(reader.getByText('lamp')).toBeTruthy();
    expect(reader.getByText('noun')).toBeTruthy();
    expect(reader.getByText('a light')).toBeTruthy();
    expect(reader.getByText('origin_suggestion')).toBeTruthy();
    // every row says who made the change: the reader by name…
    expect(reader.getByTestId('author-3').textContent).toBe('Ada');
    expect(reader.getByText(/A light\. → A device that gives light\./)).toBeTruthy();
    expect(reader.getByText('state_active')).toBeTruthy();
    expect(reader.getByTestId('revert-3')).toBeTruthy();

    // …the owner of the instance, with no tag: an edit of theirs is the rule…
    expect(replaced.getByTestId('author-2').textContent).toBe('author_admin');
    expect(replaced.queryByText('origin_admin')).toBeNull();
    expect(replaced.getByText(/^state_superseded/)).toBeTruthy();
    expect(replaced.queryByTestId('revert-2')).toBeNull();

    // …and so is what took a change back, which is said next to it
    expect(takenBack.getByTestId('author-1').textContent).toBe('author_admin');
    expect(takenBack.getByText('origin_revert')).toBeTruthy();
    expect(takenBack.queryByTestId('revert-1')).toBeNull();
  });

  it('keeps a row short and shows the values in full on demand', async () => {
    const long = 'a very long definition '.repeat(10).trim();
    (EnApi.getChanges as jest.Mock).mockResolvedValue(
      listOf([
        change({
          action: ChangeActionE.create,
          diff: {
            description: { before: null, after: long },
            transcription: { before: null, after: '/læmp/' },
            word_level: { before: null, after: 'A1' },
            categories: { before: null, after: ['home'] },
            meanings: { before: null, after: [{ title: 'a light' }] },
            is_obsolete: { before: null, after: false },
          },
        }),
      ]),
    );

    renderHistory();

    await screen.findByTestId('revert-1');
    // three fields and how many more; a field that says nothing is not counted
    expect(screen.getByText('more_fields {"count":2}')).toBeTruthy();
    expect(screen.queryByText(long)).toBeNull();
    expect(screen.queryByTestId('values-1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'show_values' }));

    const values = within(await screen.findByTestId('values-1'));
    expect(values.getByText(long)).toBeTruthy();
    expect(values.getByText('meanings')).toBeTruthy();
    expect(values.queryByText('is_obsolete')).toBeNull();
    expect(screen.getByRole('button', { name: 'hide_values' })).toBeTruthy();
  });

  it('asks for the history of one article when it is shown on the card of a word', async () => {
    (EnApi.getChanges as jest.Mock).mockResolvedValue(listOf([change()]));

    renderHistory({ headword: 'lamp', partOfSpeech: 'noun', pageSize: 10 });

    await screen.findByTestId('revert-1');
    expect(EnApi.getChanges).toHaveBeenCalledWith(
      expect.objectContaining({ headword: 'lamp', part_of_speech: 'noun', page: 1, limit: 10 }),
    );
    // the card is about one word: nothing to search for, and no row repeats the headword
    expect(screen.queryByPlaceholderText('filter_search')).toBeNull();
    expect(screen.queryByText('lamp')).toBeNull();
  });

  it('takes a change back after a confirmation and reads the list again', async () => {
    (EnApi.getChanges as jest.Mock).mockResolvedValue(listOf([change()]));
    (EnApi.revertChange as jest.Mock).mockResolvedValue({ success: true });
    const onReverted = jest.fn();

    renderHistory({ onReverted });

    fireEvent.click(await screen.findByTestId('revert-1'));
    expect(await screen.findByText('revert_confirm')).toBeTruthy();
    expect(EnApi.revertChange).not.toHaveBeenCalled();
    const confirm = (await screen.findAllByRole('button', { name: 'revert' })).at(-1) as HTMLElement;
    fireEvent.click(confirm);

    await waitFor(() => expect(EnApi.revertChange).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onReverted).toHaveBeenCalledWith(expect.objectContaining({ id: 1 })));
    await waitFor(() => expect(EnApi.getChanges).toHaveBeenCalledTimes(2));
  });

  it('says why a change cannot be taken back', async () => {
    (EnApi.getChanges as jest.Mock).mockResolvedValue(listOf([change()]));
    (EnApi.revertChange as jest.Mock).mockResolvedValue({
      error: true,
      statusCode: 409,
      message: 'change_outdated',
    });
    const onReverted = jest.fn();

    renderHistory({ onReverted });

    fireEvent.click(await screen.findByTestId('revert-1'));
    expect(await screen.findByText('revert_confirm')).toBeTruthy();
    const confirm = (await screen.findAllByRole('button', { name: 'revert' })).at(-1) as HTMLElement;
    fireEvent.click(confirm);

    expect(await screen.findByText('change_outdated')).toBeTruthy();
    expect(onReverted).not.toHaveBeenCalled();
  });

  it('names a reader who gave no name, and finds the changes of one who did', async () => {
    (EnApi.getChanges as jest.Mock).mockResolvedValue(
      listOf([change({ id: 5, origin: ChangeOriginE.suggestion, author: null })]),
    );

    renderHistory();

    expect((await screen.findByTestId('author-5')).textContent).toBe('author_reader');
    const search = screen.getByPlaceholderText('filter_author');
    fireEvent.change(search, { target: { value: ' Ada ' } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 });

    await waitFor(() =>
      expect(EnApi.getChanges).toHaveBeenLastCalledWith(expect.objectContaining({ author: 'Ada', page: 1 })),
    );
  });

  it('filters by what still shows', async () => {
    (EnApi.getChanges as jest.Mock).mockResolvedValue(listOf([change()]));

    renderHistory();
    await screen.findByTestId('revert-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'filter_active' }));

    await waitFor(() =>
      expect(EnApi.getChanges).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, page: 1 })),
    );
  });
});

describe('ForgetAuthor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderForm = (onForgotten = jest.fn()) => {
    render(
      <App>
        <ForgetAuthor onForgotten={onForgotten} />
      </App>,
    );
    return onForgotten;
  };

  const confirm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'forget_btn' }));
    await screen.findByText(/^forget_confirm/);
    const buttons = await screen.findAllByRole('button', { name: 'forget_btn' });
    fireEvent.click(buttons.at(-1) as HTMLElement);
  };

  it('takes a name out after a confirmation', async () => {
    (EnApi.forgetChangeAuthor as jest.Mock).mockResolvedValue({ success: true, forgotten: 3 });
    const onForgotten = renderForm();

    expect((screen.getByRole('button', { name: 'forget_btn' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('forget_placeholder'), { target: { value: '  Ada Lovelace ' } });
    await confirm();

    await waitFor(() => expect(EnApi.forgetChangeAuthor).toHaveBeenCalledWith({ author: 'Ada Lovelace' }));
    expect(await screen.findByText('forgotten {"count":3}')).toBeTruthy();
    expect(onForgotten).toHaveBeenCalled();
  });

  it('says when no row names the name', async () => {
    (EnApi.forgetChangeAuthor as jest.Mock).mockResolvedValue({ success: true, forgotten: 0 });
    const onForgotten = renderForm();

    fireEvent.change(screen.getByLabelText('forget_placeholder'), { target: { value: 'Nobody' } });
    await confirm();

    expect(await screen.findByText('forgotten_none {"name":"Nobody"}')).toBeTruthy();
    expect(onForgotten).not.toHaveBeenCalled();
  });
});

describe('the values of a change', () => {
  it('leaves out the fields of a creation that say nothing', () => {
    expect(
      shownFields({
        description: { before: null, after: 'a device' },
        transcription: { before: null, after: null },
        categories: { before: null, after: [] },
        is_obsolete: { before: null, after: false },
        word_level: { before: 'A1', after: null },
      }).map(([field]) => field),
    ).toEqual(['description', 'word_level']);
  });

  it('shortens a long value and shows a dash for nothing', () => {
    expect(shortValue(null)).toBe('—');
    expect(shortValue([])).toBe('—');
    expect(shortValue('a device')).toBe('a device');
    expect(shortValue(['a', 'b'])).toBe('["a","b"]');
    expect(shortValue('x'.repeat(200))).toHaveLength(78);
  });

  it('names a record by what it says', () => {
    expect(recordName(null)).toBeNull();
    expect(recordName({ word: 'mice', form_of_word: 'plural_form' })).toBe('mice');
    expect(recordName({ title: 'a light', sort_order: 1 })).toBe('a light');
    expect(recordName({ meaning: { title: 'a light', sort_order: 1 }, language: 'ru', title: 'лампа' })).toBe(
      'a light · ru · лампа',
    );
    expect(recordName({ language: 'es', description: 'lámpara' })).toBe('es · lámpara');
  });
});
