/** Megabytes the way a reader says them: `170 MB`, `1.4 GB` */
export const formatMegabytes = (megabytes: number, locale: string): string => {
  if (megabytes >= 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes / 1000)} GB`;
  }
  return `${new Intl.NumberFormat(locale).format(megabytes)} MB`;
};

export const formatCount = (count: number, locale: string): string =>
  new Intl.NumberFormat(locale).format(count);
