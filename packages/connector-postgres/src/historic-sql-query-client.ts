import type { KloPostgresQueryClient } from '@klo/context/ingest';
import { KloPostgresScanConnector, type KloPostgresScanConnectorOptions } from './connector.js';

export type KloPostgresHistoricSqlQueryClientOptions = KloPostgresScanConnectorOptions;

export class KloPostgresHistoricSqlQueryClient implements KloPostgresQueryClient {
  private readonly connectionId: string;
  private readonly connector: KloPostgresScanConnector;

  constructor(options: KloPostgresHistoricSqlQueryClientOptions) {
    this.connectionId = options.connectionId;
    this.connector = new KloPostgresScanConnector(options);
  }

  async executeQuery(
    sql: string,
    params?: unknown[],
  ): Promise<{ headers: string[]; rows: unknown[][]; totalRows: number }> {
    const result = await this.connector.executeReadOnly(
      {
        connectionId: this.connectionId,
        sql,
        params,
      },
      {} as never,
    );
    return {
      headers: result.headers,
      rows: result.rows,
      totalRows: result.totalRows,
    };
  }

  async cleanup(): Promise<void> {
    await this.connector.cleanup();
  }
}
