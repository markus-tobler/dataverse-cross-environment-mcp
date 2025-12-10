import {
  TableMetadata,
  TableDescription,
  CachedTableDescription,
} from "../types/dataverse.js";
import { logger } from "../utils/logger.js";

/**
 * Cache entry with timestamp for TTL management
 */
interface CachedItem<T> {
  value: T;
  timestamp: Date;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  tableMetadata: {
    entries: number;
    lastUpdated: Date;
  };
  tableDescriptions: {
    entries: number;
    importantOnly: number;
    full: number;
  };
  entitySetNames: {
    forwardCache: number;
    reverseCache: number;
  };
}

/**
 * Centralized metadata cache service for Dataverse
 * Manages all metadata caching with consistent TTL and eviction policies
 */
export class MetadataCacheService {
  // Cache stores
  private tableMetadataCache: Map<string, CachedItem<TableMetadata[]>> =
    new Map();
  private tableDescriptionCache: Map<string, CachedTableDescription> =
    new Map();
  private entitySetNameCache: Map<string, CachedItem<string>> = new Map();
  private reverseEntitySetNameCache: Map<string, CachedItem<string>> =
    new Map();
  private importantColumnsCache: Map<string, CachedItem<string[]>> = new Map();
  private readableEntityNamesCache: Map<string, CachedItem<Set<string>>> =
    new Map();

  // Cache expiration times
  private readonly tableMetadataTTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly tableDescriptionTTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly entitySetNameTTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly importantColumnsTTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly readableEntityNamesTTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Get table metadata list from cache
   */
  getTableMetadata(dataverseUrl: string): TableMetadata[] | null {
    const cacheKey = `${dataverseUrl}_tables`;
    const cached = this.tableMetadataCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached.timestamp, this.tableMetadataTTL)) {
      this.tableMetadataCache.delete(cacheKey);
      return null;
    }

    return cached.value;
  }

  /**
   * Set table metadata list in cache
   */
  setTableMetadata(dataverseUrl: string, tables: TableMetadata[]): void {
    const cacheKey = `${dataverseUrl}_tables`;
    this.tableMetadataCache.set(cacheKey, {
      value: tables,
      timestamp: new Date(),
    });
  }

  /**
   * Get table description from cache
   */
  getTableDescription(
    dataverseUrl: string,
    tableName: string,
    full: boolean
  ): TableDescription | null {
    const cacheKey = `${dataverseUrl}_${tableName}_${full}`;
    const cached = this.tableDescriptionCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached.timestamp, this.tableDescriptionTTL)) {
      this.tableDescriptionCache.delete(cacheKey);
      return null;
    }

    return cached.description;
  }

  /**
   * Set table description in cache
   */
  setTableDescription(
    dataverseUrl: string,
    tableName: string,
    description: TableDescription,
    full: boolean
  ): void {
    const cacheKey = `${dataverseUrl}_${tableName}_${full}`;
    this.tableDescriptionCache.set(cacheKey, {
      description,
      timestamp: new Date(),
    });
  }

  /**
   * Get readable entity names from cache
   * @param dataverseUrl - The Dataverse URL
   * @param userId - User ID for user-specific caching (readable entities are based on user privileges)
   */
  getReadableEntityNames(dataverseUrl: string, userId: string): Set<string> | null {
    const cacheKey = `${dataverseUrl}_${userId}_readableEntityNames`;
    const cached = this.readableEntityNamesCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached.timestamp, this.readableEntityNamesTTL)) {
      this.readableEntityNamesCache.delete(cacheKey);
      return null;
    }

    return cached.value;
  }

  /**
   * Set readable entity names in cache
   * @param dataverseUrl - The Dataverse URL
   * @param userId - User ID for user-specific caching (readable entities are based on user privileges)
   * @param entityNames - Set of entity names
   */
  setReadableEntityNames(dataverseUrl: string, userId: string, entityNames: Set<string>): void {
    const cacheKey = `${dataverseUrl}_${userId}_readableEntityNames`;
    this.readableEntityNamesCache.set(cacheKey, {
      value: entityNames,
      timestamp: new Date(),
    });
  }

  /**
   * Get important columns for a table from cache (OData-compatible names)
   * Returns null if not cached or expired
   * @param dataverseUrl - The Dataverse URL
   * @param tableName - The table name
   * @param userId - Optional user ID for user-specific caching (important columns are based on sampled data)
   */
  getImportantColumns(
    dataverseUrl: string,
    tableName: string,
    userId?: string
  ): string[] | null {
    const cacheKey = userId 
      ? `${dataverseUrl}_${userId}_${tableName}_important`
      : `${dataverseUrl}_${tableName}_important`;
    const cached = this.importantColumnsCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached.timestamp, this.importantColumnsTTL)) {
      this.importantColumnsCache.delete(cacheKey);
      return null;
    }

    return cached.value;
  }

  /**
   * Set important columns for a table in cache (OData-compatible names)
   * @param dataverseUrl - The Dataverse URL
   * @param tableName - The table name
   * @param columns - Array of column names
   * @param userId - Optional user ID for user-specific caching (important columns are based on sampled data)
   */
  setImportantColumns(
    dataverseUrl: string,
    tableName: string,
    columns: string[],
    userId?: string
  ): void {
    const cacheKey = userId 
      ? `${dataverseUrl}_${userId}_${tableName}_important`
      : `${dataverseUrl}_${tableName}_important`;
    this.importantColumnsCache.set(cacheKey, {
      value: columns,
      timestamp: new Date(),
    });
  }

  /**
   * Get important columns for a table with async cache warming
   * If cache miss, calls the provided callback to warm the cache
   * @param dataverseUrl - The Dataverse URL
   * @param tableName - The table name
   * @param userId - Optional user ID for user-specific caching (important columns are based on sampled data)
   * @param warmCache - Optional callback to warm cache on cache miss
   * @returns Array of important column names, or empty array if unavailable
   */
  async getImportantColumnsAsync(
    dataverseUrl: string,
    tableName: string,
    userId?: string,
    warmCache?: () => Promise<string[]>
  ): Promise<string[]> {
    // Try dedicated important columns cache first
    const columns = this.getImportantColumns(dataverseUrl, tableName, userId);

    if (columns) {
      logger.debug(
        `Using ${columns.length} important columns from cache for ${tableName}:`,
        columns
      );
      return columns;
    }

    // Cache miss - use callback to warm cache if provided
    if (warmCache) {
      try {
        logger.debug(
          `Cache miss for important columns of ${tableName}, building cache...`
        );
        const convertedColumns = await warmCache();
        // Store the converted columns in cache
        this.setImportantColumns(dataverseUrl, tableName, convertedColumns, userId);
        logger.debug(
          `Cached ${convertedColumns.length} converted important columns for ${tableName}:`,
          convertedColumns
        );
        return convertedColumns;
      } catch (error) {
        logger.warn(
          `Could not get important columns for ${tableName}, using default:`,
          error
        );
      }
    }

    return [];
  }

  /**
   * Get entity set name from logical name
   */
  getEntitySetName(dataverseUrl: string, logicalName: string): string | null {
    const cacheKey = `${dataverseUrl}_${logicalName}`;
    const cached = this.entitySetNameCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached.timestamp, this.entitySetNameTTL)) {
      this.entitySetNameCache.delete(cacheKey);
      return null;
    }

    return cached.value;
  }

  /**
   * Set entity set name mapping (logical name -> entity set name)
   */
  setEntitySetName(
    dataverseUrl: string,
    logicalName: string,
    entitySetName: string
  ): void {
    const cacheKey = `${dataverseUrl}_${logicalName}`;
    this.entitySetNameCache.set(cacheKey, {
      value: entitySetName,
      timestamp: new Date(),
    });
  }

  /**
   * Get entity set name from reverse cache (entity set name -> entity set name)
   * Used for validating if a name is already an entity set name
   */
  getReverseEntitySetName(
    dataverseUrl: string,
    entitySetName: string
  ): string | null {
    const cacheKey = `${dataverseUrl}_${entitySetName}`;
    const cached = this.reverseEntitySetNameCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached.timestamp, this.entitySetNameTTL)) {
      this.reverseEntitySetNameCache.delete(cacheKey);
      return null;
    }

    return cached.value;
  }

  /**
   * Set reverse entity set name mapping (entity set name -> entity set name)
   */
  setReverseEntitySetName(dataverseUrl: string, entitySetName: string): void {
    const cacheKey = `${dataverseUrl}_${entitySetName}`;
    this.reverseEntitySetNameCache.set(cacheKey, {
      value: entitySetName,
      timestamp: new Date(),
    });
  }

  /**
   * Populate entity set name caches together (coordination)
   * Should be called when both logical and entity set names are known
   */
  setEntitySetNameBidirectional(
    dataverseUrl: string,
    logicalName: string,
    entitySetName: string
  ): void {
    this.setEntitySetName(dataverseUrl, logicalName, entitySetName);
    this.setReverseEntitySetName(dataverseUrl, entitySetName);
  }

  /**
   * Ensure known system entities are in cache
   */
  ensureSystemEntities(dataverseUrl: string): void {
    const systemEntities = [
      { logicalName: "systemuser", entitySetName: "systemusers" },
      { logicalName: "businessunit", entitySetName: "businessunits" },
      { logicalName: "organization", entitySetName: "organizations" },
    ];

    for (const entity of systemEntities) {
      // Only add if not already cached
      if (!this.getEntitySetName(dataverseUrl, entity.logicalName)) {
        this.setEntitySetNameBidirectional(
          dataverseUrl,
          entity.logicalName,
          entity.entitySetName
        );
      }
    }
  }

  /**
   * Clear all expired entries from all caches
   */
  clearExpired(): void {
    const now = new Date();

    // Clear expired table metadata
    for (const [key, item] of this.tableMetadataCache.entries()) {
      if (this.isExpired(item.timestamp, this.tableMetadataTTL)) {
        this.tableMetadataCache.delete(key);
      }
    }

    // Clear expired table descriptions
    for (const [key, item] of this.tableDescriptionCache.entries()) {
      if (this.isExpired(item.timestamp, this.tableDescriptionTTL)) {
        this.tableDescriptionCache.delete(key);
      }
    }

    // Clear expired entity set names
    for (const [key, item] of this.entitySetNameCache.entries()) {
      if (this.isExpired(item.timestamp, this.entitySetNameTTL)) {
        this.entitySetNameCache.delete(key);
      }
    }

    // Clear expired reverse entity set names
    for (const [key, item] of this.reverseEntitySetNameCache.entries()) {
      if (this.isExpired(item.timestamp, this.entitySetNameTTL)) {
        this.reverseEntitySetNameCache.delete(key);
      }
    }

    // Clear expired important columns
    for (const [key, item] of this.importantColumnsCache.entries()) {
      if (this.isExpired(item.timestamp, this.importantColumnsTTL)) {
        this.importantColumnsCache.delete(key);
      }
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.tableMetadataCache.clear();
    this.tableDescriptionCache.clear();
    this.entitySetNameCache.clear();
    this.reverseEntitySetNameCache.clear();
    this.importantColumnsCache.clear();
  }

  /**
   * Clear only the important columns cache
   * Useful when column conversion logic changes
   */
  clearImportantColumnsCache(): void {
    this.importantColumnsCache.clear();
    logger.info("Cleared important columns cache");
  }

  /**
   * Clear table descriptions cache
   * Useful when description generation logic changes
   */
  clearTableDescriptionsCache(): void {
    this.tableDescriptionCache.clear();
    logger.info("Cleared table descriptions cache");
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    let importantOnlyCount = 0;
    let fullCount = 0;

    for (const [key] of this.tableDescriptionCache.entries()) {
      if (key.endsWith("_false")) {
        importantOnlyCount++;
      } else if (key.endsWith("_true")) {
        fullCount++;
      }
    }

    // Get the most recent timestamp from table metadata cache
    let mostRecentUpdate = new Date(0);
    for (const [, item] of this.tableMetadataCache.entries()) {
      if (item.timestamp > mostRecentUpdate) {
        mostRecentUpdate = item.timestamp;
      }
    }

    return {
      tableMetadata: {
        entries: this.tableMetadataCache.size,
        lastUpdated: mostRecentUpdate,
      },
      tableDescriptions: {
        entries: this.tableDescriptionCache.size,
        importantOnly: importantOnlyCount,
        full: fullCount,
      },
      entitySetNames: {
        forwardCache: this.entitySetNameCache.size,
        reverseCache: this.reverseEntitySetNameCache.size,
      },
    };
  }

  /**
   * Check if a cached item is expired
   */
  private isExpired(timestamp: Date, ttl: number): boolean {
    const now = new Date();
    return now.getTime() - timestamp.getTime() >= ttl;
  }
}
