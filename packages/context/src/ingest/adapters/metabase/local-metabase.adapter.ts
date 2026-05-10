import type { KloLocalProject, KloProjectConnectionConfig } from '../../../project/index.js';
import { kloLocalStateDbPath } from '../../../project/index.js';
import { DEFAULT_METABASE_CLIENT_CONFIG, DefaultMetabaseConnectionClientFactory } from './client.js';
import {
  IngestMetabaseClientFactory,
  type MetabaseClientConfig,
  type MetabaseClientRuntimeConfig,
} from './client-port.js';
import { LocalMetabaseSourceStateReader } from './local-source-state-store.js';
import { MetabaseSourceAdapter } from './metabase.adapter.js';

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveEnvReference(ref: string, env: NodeJS.ProcessEnv): string | null {
  if (!ref.startsWith('env:')) {
    return null;
  }
  const name = ref.slice('env:'.length);
  return stringField(env[name]);
}

function hasNetworkProxy(connection: KloProjectConnectionConfig): boolean {
  return connection.networkProxy != null || connection.network_proxy != null;
}

export function metabaseRuntimeConfigFromLocalConnection(
  connectionId: string,
  connection: KloProjectConnectionConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MetabaseClientRuntimeConfig {
  if (!connection || String(connection.driver).toLowerCase() !== 'metabase') {
    throw new Error(`Connection "${connectionId}" is not a Metabase connection`);
  }
  if (hasNetworkProxy(connection)) {
    throw new Error(
      `Standalone KLO does not support proxy-bearing Metabase connections yet. Use hosted Metabase ingest for "${connectionId}" until the KLO Metabase proxy support spec lands.`,
    );
  }

  const apiUrl = stringField(connection.api_url) ?? stringField(connection.apiUrl) ?? stringField(connection.url);
  const literalApiKey = stringField(connection.api_key) ?? stringField(connection.apiKey);
  const apiKeyRef = stringField(connection.api_key_ref) ?? stringField(connection.apiKeyRef);
  const apiKey = literalApiKey ?? (apiKeyRef ? resolveEnvReference(apiKeyRef, env) : null);

  if (!apiUrl) {
    throw new Error(`Connection "${connectionId}" is missing metabase api_url`);
  }
  if (!apiKey) {
    throw new Error(`Connection "${connectionId}" is missing metabase api_key or api_key_ref`);
  }

  return { apiUrl, apiKey };
}

interface CreateLocalMetabaseSourceAdapterOptions {
  env?: NodeJS.ProcessEnv;
  defaultClientConfig?: MetabaseClientConfig;
}

export function createLocalMetabaseSourceAdapter(
  project: KloLocalProject,
  options: CreateLocalMetabaseSourceAdapterOptions = {},
): MetabaseSourceAdapter {
  const sourceStateReader = new LocalMetabaseSourceStateReader({ dbPath: kloLocalStateDbPath(project) });
  const connectionFactory = new DefaultMetabaseConnectionClientFactory(
    (metabaseConnectionId) =>
      metabaseRuntimeConfigFromLocalConnection(
        metabaseConnectionId,
        project.config.connections[metabaseConnectionId],
        options.env,
      ),
    options.defaultClientConfig ?? DEFAULT_METABASE_CLIENT_CONFIG,
  );
  return new MetabaseSourceAdapter({
    clientFactory: new IngestMetabaseClientFactory(connectionFactory),
    sourceStateReader,
  });
}
