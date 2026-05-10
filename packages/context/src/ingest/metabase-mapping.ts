export {
  computeMetabaseMappingDrift,
  computeMetabaseMappingPhysicalMismatches,
  discoverMetabaseDatabases,
  findBestMatch,
  METABASE_ENGINE_TO_CONNECTION_TYPE,
  refreshMetabaseMapping,
  validateMappingPhysicalMatch,
  validateMetabaseMappings,
} from './adapters/metabase/mapping.js';
export type {
  AutoMatchCandidate,
  AutoMatchResult as MetabaseAutoMatchResult,
  DiscoveredMetabaseDatabase,
  KloConnectionPhysicalInfo,
  MappingPhysicalInfo,
  MappingRefreshReport,
  MetabaseMappedConnectionType,
  MetabaseMappingDrift,
  MetabaseMappingValidationResult,
  PhysicalMismatch,
  PhysicalMismatchInput,
} from './adapters/metabase/mapping.js';
