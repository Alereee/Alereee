import React from 'react';
import { render, screen } from '@testing-library/react';
import { App } from 'antd';
import { DatasetT } from 'server/types';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ wordId: '1' }),
}));

jest.mock('@/core/api/EnApi', () => ({ EnApi: {} }));

import { EditedDataset, EditLicenseNote } from '../index';
import { CommonInfoFields } from '../../CommonInfoFields';
import { DeleteMeaningModal } from '../../WordCard/components/MeaningsPreview/components/DeleteMeaningModal';

const WIKTIONARY = {
  name: 'wiktionary',
  title: 'English Wiktionary',
  installed: true,
  source: 'wiktionary',
  license: 'CC-BY-SA-4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  active: true,
} as DatasetT;

// Under which license an edit is published, said before the edit (issue #531)
describe('EditLicenseNote', () => {
  it('names the dataset and its license, with the link, and what the edit leads to', () => {
    render(
      <EditedDataset dataset={WIKTIONARY}>
        <EditLicenseNote />
      </EditedDataset>,
    );

    const note = screen.getByTestId('edit-license-note');
    expect(note).toHaveTextContent('editing_license {"dataset":"English Wiktionary"}');
    expect(note).toHaveTextContent('editing_license_effect');
    expect(screen.getByRole('link', { name: 'CC-BY-SA-4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
  });

  it('says of a dataset of a public source that nothing generated is added to it, and hides the switch', () => {
    render(
      <EditedDataset dataset={WIKTIONARY}>
        <EditLicenseNote />
        <CommonInfoFields
          pos={'noun' as never}
          value={{ generated: true } as never}
          onChange={() => undefined}
        />
      </EditedDataset>,
    );

    expect(screen.getByTestId('edit-license-note')).toHaveTextContent('editing_no_generated');
    expect(screen.queryByText('is_ai_generated')).not.toBeInTheDocument();
    expect(screen.queryByText('source_model')).not.toBeInTheDocument();
  });

  it('keeps the switch for the dataset of the project, which says that it is generated', () => {
    render(
      <EditedDataset dataset={{ ...WIKTIONARY, name: 'default', source: 'vocab-bloom-hub' }}>
        <EditLicenseNote />
        <CommonInfoFields
          pos={'noun' as never}
          value={{ generated: true } as never}
          onChange={() => undefined}
        />
      </EditedDataset>,
    );

    expect(screen.getByTestId('edit-license-note')).not.toHaveTextContent('editing_no_generated');
    expect(screen.getByText('is_ai_generated')).toBeInTheDocument();
  });

  it('names a license without a link as text', () => {
    render(
      <EditedDataset dataset={{ ...WIKTIONARY, license_url: '' }}>
        <EditLicenseNote />
      </EditedDataset>,
    );

    expect(screen.getByTestId('edit-license-note')).toHaveTextContent('CC-BY-SA-4.0');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says nothing where the dataset is not known', () => {
    render(<EditLicenseNote />);

    expect(screen.queryByTestId('edit-license-note')).not.toBeInTheDocument();
  });

  it('reaches a dialog of the word card, which opens outside the card', () => {
    render(
      <App>
        <EditedDataset dataset={WIKTIONARY}>
          <DeleteMeaningModal
            isOpen
            onClose={() => undefined}
            onOk={() => undefined}
            meaning={{ id: 1, title: 'a light' } as never}
          />
        </EditedDataset>
      </App>,
    );

    expect(screen.getByRole('dialog')).toContainElement(screen.getByTestId('edit-license-note'));
  });
});
