const PLACEHOLDER_PREFIX = 'replace-';

export const normalizeStage = (stage: string | undefined): string => (stage ?? 'local').trim().toLowerCase();

export const isLocalStage = (stage: string | undefined): boolean => normalizeStage(stage) === 'local';

export const isPlaceholderValue = (value: string): boolean => value.trim().toLowerCase().startsWith(PLACEHOLDER_PREFIX);

export const assertConfiguredSecret = (name: string, value: string | undefined, stage: string | undefined): string => {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }

  if (!isLocalStage(stage) && isPlaceholderValue(normalized)) {
    throw new Error(`${name} must be set with a non-placeholder value for stage ${normalizeStage(stage)}.`);
  }

  return normalized;
};
