import { describe, expect, it } from 'vitest';
import type {
  ApplyLocalScanRelationshipReviewDecisionsInput,
  ApplyLocalScanRelationshipReviewDecisionsResult,
} from './scan/index.js';

const scanTypeExportCoverage: Partial<{
  input: ApplyLocalScanRelationshipReviewDecisionsInput;
  result: ApplyLocalScanRelationshipReviewDecisionsResult;
}> = {};

describe('@klo/context package exports', () => {
  it('exports package entry points used by host adapters', async () => {
    const core = await import('./core/index.js');
    const connections = await import('./connections/index.js');
    const scan = await import('./scan/index.js');
    const search = await import('./search/index.js');
    const agent = await import('./agent/index.js');
    const prompts = await import('./prompts/index.js');
    const skills = await import('./skills/index.js');
    const sl = await import('./sl/index.js');
    const wiki = await import('./wiki/index.js');
    const tools = await import('./tools/index.js');
    const memory = await import('./memory/index.js');
    const ingest = await import('./ingest/index.js');
    const memoryFlow = await import('./ingest/memory-flow/index.js');
    const metabaseMapping = await import('./ingest/metabase-mapping.js');
    const mcp = await import('./mcp/index.js');
    const project = await import('./project/index.js');
    const daemon = await import('./daemon/index.js');
    const sqlAnalysis = await import('./sql-analysis/index.js');
    const root = await import('./index.js');

    expect(core).toBeDefined();
    expect(connections.createPostgresQueryExecutor).toBeTypeOf('function');
    expect(connections.createSqliteQueryExecutor).toBeTypeOf('function');
    expect(connections.createDefaultLocalQueryExecutor).toBeTypeOf('function');
    expect(connections.sqliteDatabasePathFromConnection).toBeTypeOf('function');
    expect(connections.parseNotionConnectionConfig).toBeTypeOf('function');
    expect(connections.redactNotionConnectionConfig).toBeTypeOf('function');
    expect(connections.notionConnectionToPullConfig).toBeTypeOf('function');
    expect(scan).toBeDefined();
    expect(scanTypeExportCoverage).toEqual({});
    expect(scan.createKloConnectorCapabilities).toBeTypeOf('function');
    expect(`liveDatabaseSnapshotToKlo${'SchemaSnapshot'}` in scan).toBe(false);
    expect(scan.normalizeKloNativeType).toBeTypeOf('function');
    expect(scan.inferKloDimensionType).toBeTypeOf('function');
    expect(scan.redactKloCredentialEnvelope).toBeTypeOf('function');
    expect(scan.redactKloScanReport).toBeTypeOf('function');
    expect(scan.redactKloScanWarning).toBeTypeOf('function');
    expect(core.redactKloSensitiveMetadata).toBeTypeOf('function');
    expect(core.redactKloSensitiveText).toBeTypeOf('function');
    expect(scan.isKloDataDictionaryCandidate).toBeTypeOf('function');
    expect(scan.buildKloColumnEmbeddingText).toBeTypeOf('function');
    expect(scan.KloDescriptionGenerator).toBeTypeOf('function');
    expect(scan.KloScanOrchestrator).toBeTypeOf('function');
    expect(scan.runLocalScan).toBeTypeOf('function');
    expect(scan.writeLocalScanEnrichmentArtifacts).toBeTypeOf('function');
    expect(scan.readLocalScanStructuralSnapshot).toBeTypeOf('function');
    expect(scan.writeLocalScanManifestShards).toBeTypeOf('function');
    expect(scan.appendKloWordLimitInstruction).toBeTypeOf('function');
    expect(scan.buildKloColumnDescriptionPrompt).toBeTypeOf('function');
    expect(scan.buildKloTableDescriptionPrompt).toBeTypeOf('function');
    expect(scan.buildKloDataSourceDescriptionPrompt).toBeTypeOf('function');
    expect(scan.currentKloRelationshipBenchmarkDetector).toBeTypeOf('function');
    expect(scan.generateKloRelationshipDiscoveryCandidates).toBeTypeOf('function');
    expect(scan.inferKloRelationshipTargetPks).toBeTypeOf('function');
    expect(scan.mergeKloRelationshipDiscoveryCandidates).toBeTypeOf('function');
    expect(scan.normalizeKloRelationshipName).toBeTypeOf('function');
    expect(scan.tokenizeKloRelationshipName).toBeTypeOf('function');
    expect(scan.tokenSimilarity).toBeTypeOf('function');
    expect(scan.localCandidateTables).toBeTypeOf('function');
    expect(scan.scoreKloRelationshipCandidate).toBeTypeOf('function');
    expect(scan.defaultKloRelationshipScoreWeights).toBeTypeOf('function');
    expect(scan.normalizeKloRelationshipScoreWeights).toBeTypeOf('function');
    expect(scan.calibrateWeightsFromSyntheticFixtures).toBeTypeOf('function');
    expect(scan.singularizeKloRelationshipToken).toBeTypeOf('function');
    expect(scan.pluralizeKloRelationshipToken).toBeTypeOf('function');
    expect(scan.collectKloFormalMetadataRelationships).toBeTypeOf('function');
    expect(scan.discoverKloCompositeRelationships).toBeTypeOf('function');
    expect(scan.proposeKloRelationshipCandidatesWithLlm).toBeTypeOf('function');
    expect(scan.profileKloRelationshipSchema).toBeTypeOf('function');
    expect(scan.quoteKloRelationshipIdentifier).toBeTypeOf('function');
    expect(scan.formatKloRelationshipTableRef).toBeTypeOf('function');
    expect(scan.validateKloRelationshipDiscoveryCandidates).toBeTypeOf('function');
    expect(scan.applyKloRelationshipValidationBudget).toBeTypeOf('function');
    expect(scan.defaultKloRelationshipValidationBudget).toBeTypeOf('function');
    expect(scan.resolveKloRelationshipGraph).toBeTypeOf('function');
    expect(scan.discoverKloRelationships).toBeTypeOf('function');
    expect('KloRelationshipDetector' in scan).toBe(false);
    expect('defaultKloRelationshipDetectionSettings' in scan).toBe(false);
    expect('KLO_RELATIONSHIP_DETECTION_CONFIDENCE' in scan).toBe(false);
    expect(scan.buildKloRelationshipArtifacts).toBeTypeOf('function');
    expect(scan.buildKloRelationshipDiagnostics).toBeTypeOf('function');
    expect(scan.readLocalScanRelationshipArtifacts).toBeTypeOf('function');
    expect(scan.writeLocalScanRelationshipReviewDecision).toBeTypeOf('function');
    expect(scan.applyLocalScanRelationshipReviewDecisions).toBeTypeOf('function');
    expect(scan.exportLocalRelationshipFeedbackLabels).toBeTypeOf('function');
    expect(scan.formatKloRelationshipFeedbackLabelsJsonl).toBeTypeOf('function');
    expect(scan.buildKloRelationshipFeedbackCalibrationReport).toBeTypeOf('function');
    expect(scan.calibrateLocalRelationshipFeedbackLabels).toBeTypeOf('function');
    expect(scan.formatKloRelationshipFeedbackCalibrationMarkdown).toBeTypeOf('function');
    expect(scan.buildKloRelationshipThresholdAdviceReport).toBeTypeOf('function');
    expect(scan.adviseLocalRelationshipFeedbackThresholds).toBeTypeOf('function');
    expect(scan.formatKloRelationshipThresholdAdviceMarkdown).toBeTypeOf('function');
    expect(scan.emptyKloRelationshipProfileArtifact).toBeTypeOf('function');
    expect(scan.loadKloRelationshipBenchmarkFixture).toBeTypeOf('function');
    expect(scan.loadKloRelationshipBenchmarkFixtures).toBeTypeOf('function');
    expect(scan.maskKloRelationshipBenchmarkSnapshot).toBeTypeOf('function');
    expect(scan.runKloRelationshipBenchmarkCase).toBeTypeOf('function');
    expect(scan.runKloRelationshipBenchmarkSuite).toBeTypeOf('function');
    expect(scan.KLO_RELATIONSHIP_BENCHMARK_MODES).toEqual([
      'metadata_present',
      'declared_fks_removed',
      'declared_pks_removed',
      'declared_pks_and_declared_fks_removed',
      'llm_disabled',
      'profiling_disabled',
      'validation_disabled',
      'embeddings_disabled',
    ]);
    expect(scan.buildKloRelationshipBenchmarkReport).toBeTypeOf('function');
    expect(scan.formatKloRelationshipBenchmarkReportMarkdown).toBeTypeOf('function');
    expect(search).toBeDefined();
    expect(search.HybridSearchCore).toBeTypeOf('function');
    expect(search.normalizeSearchQuery).toBeTypeOf('function');
    expect(search.rrfContribution).toBeTypeOf('function');
    expect(search.assertSearchBackendConformanceCase).toBeTypeOf('function');
    expect(search.assertSearchBackendCapabilities).toBeTypeOf('function');
    expect(core.resolveKloConfigReference).toBeTypeOf('function');
    expect(root.HybridSearchCore).toBeTypeOf('function');
    expect(root.assertSearchBackendConformanceCase).toBeTypeOf('function');
    expect(root.assertSearchBackendCapabilities).toBeTypeOf('function');
    expect(root.createLocalKloEmbeddingProviderFromConfig).toBeTypeOf('function');
    expect(agent).toBeDefined();
    expect(agent.AgentRunnerService).toBeTypeOf('function');
    expect(root.AgentRunnerService).toBeTypeOf('function');
    expect(root.createLocalKloLlmProviderFromConfig).toBeTypeOf('function');
    expect(prompts).toBeDefined();
    expect(skills).toBeDefined();
    expect(sl).toBeDefined();
    expect(sl.writeLocalSlSource).toBeTypeOf('function');
    expect(sl.readLocalSlSource).toBeTypeOf('function');
    expect(sl.validateLocalSlSource).toBeTypeOf('function');
    expect(sl.searchLocalSlSources).toBeTypeOf('function');
    expect(sl.SqliteSlSourcesIndex).toBeTypeOf('function');
    expect('searchLocalSlSourcesWithPglitePrototype' in sl).toBe(false);
    expect(sl.compileLocalSlQuery).toBeTypeOf('function');
    expect(wiki).toBeDefined();
    expect(wiki.writeLocalKnowledgePage).toBeTypeOf('function');
    expect(wiki.readLocalKnowledgePage).toBeTypeOf('function');
    expect(wiki.searchLocalKnowledgePages).toBeTypeOf('function');
    expect(wiki.SqliteKnowledgeIndex).toBeTypeOf('function');
    expect('WikiSearchMatchReason' in wiki).toBe(false);
    expect(tools).toBeDefined();
    expect(memory).toBeDefined();
    expect(ingest).toBeDefined();
    expect(memoryFlow.parseMemoryFlowReplayInput).toBeTypeOf('function');
    expect(memoryFlow.renderMemoryFlowReplay).toBeTypeOf('function');
    expect(ingest.LiveDatabaseSourceAdapter).toBeTypeOf('function');
    expect(ingest.createDaemonLiveDatabaseIntrospection).toBeTypeOf('function');
    expect(ingest.buildLiveDatabaseManifestShards).toBeTypeOf('function');
    expect(ingest.planLiveDatabaseStructuralSync).toBeTypeOf('function');
    expect(ingest.runLocalIngest).toBeTypeOf('function');
    expect(ingest.runLocalMetabaseIngest).toBeTypeOf('function');
    expect(ingest.getLocalIngestStatus).toBeTypeOf('function');
    expect(ingest.createLocalBundleIngestRuntime).toBeTypeOf('function');
    expect(ingest.runLocalStageOnlyIngest).toBeTypeOf('function');
    expect(ingest.getLocalStageOnlyIngestStatus).toBeTypeOf('function');
    expect(ingest.createDefaultLocalIngestAdapters).toBeTypeOf('function');
    expect(ingest.createLookerQueryToSlTool).toBeTypeOf('function');
    expect(ingest.buildLookerSlProposal).toBeTypeOf('function');
    expect(ingest.describeLookerScope).toBeTypeOf('function');
    expect(ingest.hashLookerScope).toBeTypeOf('function');
    expect(ingest.readLookerFetchReport).toBeTypeOf('function');
    expect(ingest.writeLookerFetchReport).toBeTypeOf('function');
    expect(ingest.writeLookerEvidenceDocuments).toBeTypeOf('function');
    expect(ingest.getLookerTriageSignals).toBeTypeOf('function');
    expect(ingest.LookerClient).toBeTypeOf('function');
    expect(ingest.DefaultLookerConnectionClientFactory).toBeTypeOf('function');
    expect(ingest.DefaultLookerClientFactory).toBeTypeOf('function');
    expect(ingest.LocalLookerRuntimeStore).toBeTypeOf('function');
    expect(ingest.createDaemonLookerTableIdentifierParser).toBeTypeOf('function');
    expect(ingest.createLocalLookerCredentialResolver).toBeTypeOf('function');
    expect(ingest.discoverLookerConnections).toBeTypeOf('function');
    expect(ingest.computeLookerMappingDrift).toBeTypeOf('function');
    expect(ingest.validateLookerMappings).toBeTypeOf('function');
    expect(ingest.refreshLookerMappingPlaceholders).toBeTypeOf('function');
    expect(ingest.suggestKloConnectionForLookerConnection).toBeTypeOf('function');
    expect(ingest.buildLookerPullConfigFromInputs).toBeTypeOf('function');
    expect(ingest.validateLookerWarehouseTarget).toBeTypeOf('function');
    expect(ingest.sqlglotDialectForConnectionType).toBeTypeOf('function');
    expect(ingest.lookerConnectionIdSchema).toBeDefined();
    expect(ingest.lookerRuntimeCursorsSchema).toBeDefined();
    expect(ingest.stagedSyncConfigSchema).toBeDefined();
    expect(ingest.stagedLookerScopeFileSchema).toBeDefined();
    expect(ingest.stagedLookerFetchReportSchema).toBeDefined();
    expect(ingest.LocalMetabaseSourceStateReader).toBeTypeOf('function');
    expect(ingest.createLocalMetabaseSourceAdapter).toBeTypeOf('function');
    expect(ingest.metabaseRuntimeConfigFromLocalConnection).toBeTypeOf('function');
    expect(ingest.IngestMetabaseClientFactory).toBeTypeOf('function');
    expect(ingest.MetabaseClient).toBeTypeOf('function');
    expect(ingest.DefaultMetabaseConnectionClientFactory).toBeTypeOf('function');
    expect(ingest.DEFAULT_METABASE_CLIENT_CONFIG).toMatchObject({
      maxRetries: 2,
      timeoutMs: 60000,
      retryableStatuses: [429, 500, 502, 503, 504],
    });
    expect(ingest.expandCardReferences).toBeTypeOf('function');
    expect(ingest.CardReferenceCycleError).toBeTypeOf('function');
    expect(ingest.parseMetabasePullConfig).toBeTypeOf('function');
    expect(ingest.METABASE_ENGINE_TO_CONNECTION_TYPE).toMatchObject({
      postgres: 'POSTGRESQL',
      bigquery: 'BIGQUERY',
      snowflake: 'SNOWFLAKE',
    });
    expect(metabaseMapping.METABASE_ENGINE_TO_CONNECTION_TYPE).toBe(ingest.METABASE_ENGINE_TO_CONNECTION_TYPE);
    expect(metabaseMapping.validateMappingPhysicalMatch).toBeTypeOf('function');
    expect(ingest.discoverMetabaseDatabases).toBeTypeOf('function');
    expect(ingest.computeMetabaseMappingDrift).toBeTypeOf('function');
    expect(ingest.computeMetabaseMappingPhysicalMismatches).toBeTypeOf('function');
    expect(ingest.refreshMetabaseMapping).toBeTypeOf('function');
    expect(ingest.validateMetabaseMappings).toBeTypeOf('function');
    expect(ingest.validateMappingPhysicalMatch).toBeTypeOf('function');
    expect(ingest.findBestMatch).toBeTypeOf('function');
    expect(ingest.NotionSourceAdapter).toBeTypeOf('function');
    expect(ingest.NotionClient).toBeTypeOf('function');
    expect(ingest.HistoricSqlSourceAdapter).toBeTypeOf('function');
    expect(ingest.SnowflakeHistoricSqlQueryHistoryReader).toBeTypeOf('function');
    expect(ingest.BigQueryHistoricSqlQueryHistoryReader).toBeTypeOf('function');
    expect(ingest.PostgresPgssQueryHistoryReader).toBeTypeOf('function');
    expect(ingest.stagePgStatStatementsTemplates).toBeTypeOf('function');
    expect(ingest.pgssBaselinePath).toBeTypeOf('function');
    expect(ingest.readPgssBaseline).toBeTypeOf('function');
    expect(ingest.writePgssBaselineAtomic).toBeTypeOf('function');
    expect(ingest.HistoricSqlExtensionMissingError).toBeTypeOf('function');
    expect(ingest.HistoricSqlVersionUnsupportedError).toBeTypeOf('function');
    expect(ingest.HISTORIC_SQL_SOURCE_KEY).toBe('historic-sql');
    expect(ingest.SqliteContextEvidenceStore).toBeTypeOf('function');
    expect(ingest.SqliteBundleIngestStore).toBeTypeOf('function');
    expect(ingest.CuratorPaginationService).toBeTypeOf('function');
    expect(mcp).toBeDefined();
    expect(project).toBeDefined();
    expect(daemon).toBeDefined();
    expect(mcp.registerKloContextTools).toBeTypeOf('function');
    expect(mcp.createLocalProjectMcpContextPorts).toBeTypeOf('function');
    expect(project.buildDefaultKloProjectConfig).toBeTypeOf('function');
    expect(daemon.createHttpSemanticLayerComputePort).toBeTypeOf('function');
    expect(daemon.createPythonSemanticLayerComputePort).toBeTypeOf('function');
    expect(sqlAnalysis.createHttpSqlAnalysisPort).toBeTypeOf('function');
    expect(root.createHttpSqlAnalysisPort).toBeTypeOf('function');
  });
});
