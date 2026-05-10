import type { KloSchemaSnapshot } from '../../../scan/types.js';

export interface LiveDatabaseIntrospectionPort {
  extractSchema(connectionId: string): Promise<KloSchemaSnapshot>;
}

export interface LiveDatabaseSourceAdapterDeps {
  introspection: LiveDatabaseIntrospectionPort;
  now?: () => Date;
}
