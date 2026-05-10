export const REDACTED_KLO_CREDENTIAL_VALUE = '<redacted>';

const SENSITIVE_FIELD_NAME = /(password|secret|token|api[_-]?key|private[_-]?key|passphrase|credential|authorization|url)/i;
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD_NAME.test(key);
}

export function redactKloSensitiveValue(key: string, value: unknown): unknown {
  if (isSensitiveField(key)) {
    return REDACTED_KLO_CREDENTIAL_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactKloSensitiveValue(key, item));
  }
  if (isRecord(value)) {
    return redactKloSensitiveMetadata(value);
  }
  return value;
}

export function redactKloSensitiveMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        isRecord(item) ? redactKloSensitiveMetadata(item) : redactKloSensitiveValue(key, item),
      );
      continue;
    }
    if (isRecord(value)) {
      redacted[key] = redactKloSensitiveValue(key, value);
      continue;
    }
    redacted[key] = redactKloSensitiveValue(key, value);
  }
  return redacted;
}

export function redactKloSensitiveText(value: string): string {
  return value.replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED_KLO_CREDENTIAL_VALUE}$3`);
}
