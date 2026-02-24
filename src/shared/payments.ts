export type PaymentProviderCode = 'MANUAL' | 'PAGSEGURO' | 'NUBANK';
export type PaymentMethodCode = 'PIX' | 'CREDIT_CARD';
export type PaymentChargeStatus = 'AWAITING_PAYMENT' | 'IN_ANALYSIS' | 'PAID' | 'FAILED';

export const normalizePaymentProvider = (value?: string | null): PaymentProviderCode => {
  const normalized = String(value ?? 'MANUAL').trim().toUpperCase();
  if (normalized === 'PAGSEGURO') return 'PAGSEGURO';
  if (normalized === 'NUBANK') return 'NUBANK';
  return 'MANUAL';
};

export const normalizePaymentMethod = (value?: string | null): PaymentMethodCode => {
  const normalized = String(value ?? 'PIX').trim().toUpperCase();
  if (normalized === 'CREDIT_CARD') return 'CREDIT_CARD';
  return 'PIX';
};

export const normalizePaymentChargeStatus = (value?: string | null): PaymentChargeStatus => {
  const normalized = String(value ?? 'AWAITING_PAYMENT').trim().toUpperCase();
  if (normalized === 'PAID') return 'PAID';
  if (normalized === 'FAILED') return 'FAILED';
  if (normalized === 'IN_ANALYSIS') return 'IN_ANALYSIS';
  return 'AWAITING_PAYMENT';
};
