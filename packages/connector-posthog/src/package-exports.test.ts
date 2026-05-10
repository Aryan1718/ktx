import { describe, expect, it } from 'vitest';
import * as posthog from './index.js';

describe('@klo/connector-posthog package exports', () => {
  it('exports the connector, dialect, descriptions, and live-database adapter', () => {
    expect(posthog.KloPostHogDialect).toBeTypeOf('function');
    expect(posthog.KloPostHogScanConnector).toBeTypeOf('function');
    expect(posthog.createPostHogLiveDatabaseIntrospection).toBeTypeOf('function');
    expect(posthog.getKloPostHogPropertyDescription('$browser')).toBe('User browser name.');
  });
});
