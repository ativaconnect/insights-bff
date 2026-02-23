export const DEFAULT_PRODUCT_CODE = 'INSIGHTS';

export const normalizeProductCode = (value?: string | null): string =>
  String(value ?? DEFAULT_PRODUCT_CODE)
    .trim()
    .toUpperCase() || DEFAULT_PRODUCT_CODE;
