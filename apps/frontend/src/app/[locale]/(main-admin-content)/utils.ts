import type { createTranslator, Messages } from 'use-intl/core';
import { InterfaceLanguageEnum } from '@/types/common';
import { DOCUMENTED_ENDPOINTS } from './documentation/constants';

export const getManagingButtons = (
  t: ReturnType<typeof createTranslator<Messages, 'managing'>>,
  locale: InterfaceLanguageEnum,
) => {
  return [
    { text: t('import_dictionary'), href: `/${locale}/managing/import-dictionary`, type: 'primary' as const },
    { text: t('export_dictionary'), href: `/${locale}/managing/export-dictionary`, type: 'primary' as const },
    { text: t('add_word'), href: `/${locale}/managing/add-word`, type: 'primary' as const },
    { text: t('bulk_request'), href: `/${locale}/managing/bulk-request`, type: 'primary' as const },
    { text: t('datasets'), href: `/${locale}/managing/datasets`, type: 'primary' as const },
    { text: t('edit'), href: `/${locale}/managing`, type: 'dashed' as const },
  ];
};

export const getStatisticsButtons = (
  t: ReturnType<typeof createTranslator<Messages, 'statistics'>>,
  locale: InterfaceLanguageEnum,
) => {
  return [
    { text: t('common_statistics'), href: `/${locale}/statistics/common`, type: 'primary' as const },
    {
      text: t('translations_statistics'),
      href: `/${locale}/statistics/translations`,
      type: 'primary' as const,
    },
    { text: t('issues_statistics'), href: `/${locale}/statistics/issues`, type: 'primary' as const },
  ];
};

export const getDocumentationButtons = (
  t: ReturnType<typeof createTranslator<Messages, 'documentation'>>,
  locale: InterfaceLanguageEnum,
) => {
  return DOCUMENTED_ENDPOINTS.map((endpoint) => ({
    text: t(`endpoint_${endpoint.key}`),
    href: `/${locale}/documentation/${endpoint.slug}`,
    type: 'primary' as const,
  }));
};
