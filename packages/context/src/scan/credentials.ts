import {
  redactKloSensitiveMetadata,
  redactKloSensitiveText,
  redactKloSensitiveValue,
  REDACTED_KLO_CREDENTIAL_VALUE,
} from '../core/redaction.js';
import type { KloCredentialEnvelope, KloScanReport, KloScanWarning } from './types.js';

export { REDACTED_KLO_CREDENTIAL_VALUE };

export function redactKloCredentialValue(key: string, value: unknown): unknown {
  return redactKloSensitiveValue(key, value);
}

export function redactKloScanMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactKloSensitiveMetadata(metadata);
}

export function redactKloCredentialEnvelope(envelope: KloCredentialEnvelope): KloCredentialEnvelope {
  if (envelope.kind !== 'resolved') {
    return envelope;
  }
  return {
    kind: 'resolved',
    source: envelope.source,
    redacted: true,
    values: redactKloScanMetadata(envelope.values),
  };
}

export function redactKloScanWarning(warning: KloScanWarning): KloScanWarning {
  if (!warning.metadata) {
    return {
      ...warning,
      message: redactKloSensitiveText(warning.message),
    };
  }
  return {
    ...warning,
    message: redactKloSensitiveText(warning.message),
    metadata: redactKloScanMetadata(warning.metadata),
  };
}

export function redactKloScanReport(report: KloScanReport): KloScanReport {
  return {
    ...report,
    warnings: report.warnings.map((warning) => redactKloScanWarning(warning)),
  };
}
