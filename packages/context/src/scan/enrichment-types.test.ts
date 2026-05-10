import { describe, expect, it } from 'vitest';
import type {
  KloColumnSampleUpdate,
  KloDescriptionUpdate,
  KloEmbeddingUpdate,
  KloEnrichedSchema,
  KloJoinUpdate,
  KloRelationshipEndpoint,
  KloRelationshipUpdate,
  KloScanMetadataStore,
  KloStructuralSyncPlan,
} from './enrichment-types.js';

describe('KLO scan enrichment contracts', () => {
  it('models an enriched schema with reusable table, column, and relationship metadata', () => {
    const schema: KloEnrichedSchema = {
      connectionId: 'warehouse',
      tables: [
        {
          id: 'table-orders',
          ref: { catalog: 'analytics', db: 'public', name: 'orders' },
          enabled: true,
          descriptions: { db: 'Raw orders', ai: 'Customer orders' },
          columns: [
            {
              id: 'column-orders-status',
              tableId: 'table-orders',
              tableRef: { catalog: 'analytics', db: 'public', name: 'orders' },
              name: 'status',
              nativeType: 'varchar',
              normalizedType: 'string',
              dimensionType: 'string',
              nullable: false,
              primaryKey: false,
              parentColumnId: null,
              descriptions: { db: 'Status code' },
              embedding: [0.1, 0.2],
              sampleValues: ['paid', 'refunded'],
              cardinality: 2,
            },
          ],
        },
      ],
      relationships: [
        {
          id: 'rel-orders-customers',
          source: 'formal',
          from: {
            tableId: 'table-orders',
            columnIds: ['column-orders-customer-id'],
            table: { catalog: 'analytics', db: 'public', name: 'orders' },
            columns: ['customer_id'],
          },
          to: {
            tableId: 'table-customers',
            columnIds: ['column-customers-id'],
            table: { catalog: 'analytics', db: 'public', name: 'customers' },
            columns: ['id'],
          },
          relationshipType: 'many_to_one',
          confidence: 1,
          isPrimaryKeyReference: true,
        },
      ],
    };

    expect(schema.tables[0].columns[0].sampleValues).toEqual(['paid', 'refunded']);
    expect(schema.relationships[0].source).toBe('formal');
  });

  it('models metadata-store updates without requiring a concrete store implementation', async () => {
    const structuralPlan: KloStructuralSyncPlan = {
      connectionId: 'warehouse',
      snapshotId: 'snapshot-1',
      operations: [{ kind: 'create_table', table: 'orders' }],
    };
    const descriptionUpdate: KloDescriptionUpdate = {
      connectionId: 'warehouse',
      table: { catalog: 'analytics', db: 'public', name: 'orders' },
      source: 'ai',
      tableDescription: 'Customer orders',
      columnDescriptions: { status: 'Payment lifecycle state' },
    };
    const sampleUpdate: KloColumnSampleUpdate = {
      columnId: 'column-orders-status',
      sampleValues: ['paid', 'refunded'],
      cardinality: 2,
    };
    const embeddingUpdate: KloEmbeddingUpdate = {
      columnId: 'column-orders-status',
      text: 'orders.status (varchar). Values: paid, refunded',
      embedding: [0.25, 0.75],
    };
    const relationshipUpdate: KloRelationshipUpdate = {
      connectionId: 'warehouse',
      accepted: [],
      rejected: [],
      skipped: [{ reason: 'missing parent table', relationshipId: 'candidate-1' }],
    };

    const store: KloScanMetadataStore = {
      loadSchema: async () => null,
      applyStructuralPlan: async (plan) => ({
        connectionId: plan.connectionId,
        tables: [],
        relationships: [],
      }),
      updateDescriptions: async (input) => {
        expect(input).toEqual(descriptionUpdate);
      },
      updateColumnSamples: async (input) => {
        expect(input).toEqual([sampleUpdate]);
      },
      updateColumnEmbeddings: async (input) => {
        expect(input).toEqual([embeddingUpdate]);
      },
      updateInferredRelationships: async (input) => {
        expect(input).toEqual(relationshipUpdate);
      },
    };

    await expect(store.loadSchema('warehouse')).resolves.toBeNull();
    await expect(store.applyStructuralPlan(structuralPlan)).resolves.toEqual({
      connectionId: 'warehouse',
      tables: [],
      relationships: [],
    });
    await expect(store.updateDescriptions(descriptionUpdate)).resolves.toBeUndefined();
    await expect(store.updateColumnSamples([sampleUpdate])).resolves.toBeUndefined();
    await expect(store.updateColumnEmbeddings([embeddingUpdate])).resolves.toBeUndefined();
    await expect(store.updateInferredRelationships(relationshipUpdate)).resolves.toBeUndefined();
  });
});

describe('relationship tuple contracts', () => {
  it('represents relationship endpoints and join updates as ordered column tuples', () => {
    const endpoint: KloRelationshipEndpoint = {
      tableId: 'public.order_lines',
      columnIds: ['public.order_lines.order_id', 'public.order_lines.line_number'],
      table: { catalog: null, db: 'public', name: 'order_lines' },
      columns: ['order_id', 'line_number'],
    };
    const update: KloJoinUpdate = {
      connectionId: 'warehouse',
      fromTable: 'order_line_allocations',
      fromColumns: ['order_id', 'line_number'],
      toTable: 'order_lines',
      toColumns: ['order_id', 'line_number'],
      relationship: 'many_to_one',
      author: 'klo',
      authorEmail: 'klo@example.com',
    };

    expect(endpoint.columns).toEqual(['order_id', 'line_number']);
    expect(endpoint.columnIds).toEqual(['public.order_lines.order_id', 'public.order_lines.line_number']);
    expect(update.fromColumns).toEqual(['order_id', 'line_number']);
    expect(update.toColumns).toEqual(['order_id', 'line_number']);
  });
});
