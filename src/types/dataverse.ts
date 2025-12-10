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
  isPrimaryId: boolean;
  isPrimaryName: boolean;
  isRequired: boolean;
  isReadOnly: boolean;
  maxLength?: number;
  format?: string;
  exampleValue: any;
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
