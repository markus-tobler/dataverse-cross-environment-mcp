/**
 * Types for Dataverse integration
 */

export interface DataverseConfig {
  url: string;
  apiVersion: string;
  getAccessToken: () => Promise<string>;
  timeoutInSeconds?: number;
  maxRetries?: number;
  disableCookies?: boolean;
}

export interface WhoAmIResponse {
  UserId: string;
  BusinessUnitId: string;
  OrganizationId: string;
}

export interface TableMetadata {
  logicalName: string;
  displayName: string;
  collectionName?: string;
  description?: string;
}

export interface SearchResult {
  tableName: string;
  recordId: string;
  primaryName: string;
  attributes: Record<string, any>;
  deepLink: string;
}

export interface SearchResponse {
  results: SearchResult[];
  totalRecordCount: number;
}

/**
 * Attribute metadata from Dataverse
 */
export interface AttributeMetadata {
  LogicalName: string;
  SchemaName: string;
  DisplayName?: {
    UserLocalizedLabel?: {
      Label: string;
    };
  };
  Description?: {
    UserLocalizedLabel?: {
      Label: string;
    };
  };
  AttributeType: string;
  AttributeTypeName?: {
    Value: string;
  };
  IsPrimaryId?: boolean;
  IsPrimaryName?: boolean;
  IsValidForRead?: boolean;
  IsValidForCreate?: boolean;
  IsValidForUpdate?: boolean;
  IsValidODataAttribute?: boolean;
  RequiredLevel?: {
    Value: string;
  };
  MaxLength?: number;
  Format?: string;
  Precision?: number;
  MinValue?: number;
  MaxValue?: number;
  OptionSet?: {
    Name?: string;
    IsGlobal?: boolean;
    Options: Array<{
      Value: number;
      Label: {
        UserLocalizedLabel: {
          Label: string;
        };
      };
    }>;
  };
  Targets?: string[];
  // Properties to identify computed/virtual/logical attributes
  AttributeOf?: string | null; // If set, this is a computed attribute of another attribute
  IsLogical?: boolean; // Indicates if this is a logical attribute (stored in different table)
}

/**
 * Field importance score for determining which fields to show
 */
export interface FieldImportance {
  logicalName: string;
  score: number;
  reason: string;
}

/**
 * Table description response
 */
export interface TableDescription {
  logicalName: string;
  displayName: string;
  description?: string;
  primaryIdAttribute: string;
  primaryNameAttribute?: string;
  attributes: AttributeDescription[];
  sampleRecord: Record<string, any>;
}

/**
 * Attribute description with metadata and example
 */
export interface AttributeDescription {
  logicalName: string;
  displayName: string;
  description?: string;
  type: string;
  flags?: string;
  maxLength?: number;
  format?: string;
  exampleValue: any;
  targets?: string[];
  optionSet?: Array<{
    value: number;
    label: string;
  }>;
}

/**
 * Attribute format description with detailed information for creating valid records
 */
export interface AttributeFormatDescription {
  logicalName: string;
  displayName: string;
  description?: string;
  type: string;
  flags?: string;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  precision?: number;
  format?: string;
  // For option sets (picklists)
  optionSet?: {
    name: string;
    isGlobal: boolean;
    options: Array<{
      value: number;
      label: string;
      description?: string;
    }>;
  };
  // For boolean fields
  booleanOptions?: {
    trueOption: { value: number; label: string };
    falseOption: { value: number; label: string };
  };
  // For lookup/customer/owner fields
  lookupTargets?: Array<{
    entityLogicalName: string;
    entityDisplayName: string;
    primaryIdAttribute: string;
    primaryNameAttribute: string;
  }>;
  // Guidance for LLM agents
  formatGuidance: string;
  exampleValues: Array<
    string | number | boolean | { value: number | string; label: string }
  >;
}

/**
 * Table format description for creating valid records
 */
export interface TableFormatDescription {
  logicalName: string;
  displayName: string;
  description?: string;
  primaryIdAttribute: string;
  primaryNameAttribute?: string;
  attributes: AttributeFormatDescription[];
  requiredAttributes: string[];
  // General guidance for creating records
  creationGuidance: string;
}

/**
 * Cached table description data
 */
export interface CachedTableDescription {
  description: TableDescription;
  timestamp: Date;
}

/**
 * Predefined query (savedquery or userquery)
 */
export interface PredefinedQuery {
  id: string;
  type: "savedquery" | "userquery";
  name: string;
}

/**
 * Query result with records
 */
export interface QueryResult {
  tableName: string;
  records: QueryRecord[];
  totalRecordCount: number;
}

/**
 * Individual query record
 */
export interface QueryRecord {
  recordId: string;
  attributes: Record<string, any>;
  deepLink: string;
}
