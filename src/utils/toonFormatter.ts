/**
 * TOON (Token-Oriented Object Notation) formatting utilities.
 *
 * TOON is a data format designed to reduce token usage when sending structured
 * data to LLMs. It achieves 30-60% token reduction for uniform arrays by:
 * - Declaring field names once as a header instead of repeating for each object
 * - Using compact tabular format for array data
 * - Reducing JSON structural overhead (braces, quotes, colons)
 *
 * @see https://github.com/toon-format/toon
 */

import { encode as toonEncode } from "@toon-format/toon";

/**
 * Output format options for MCP tool responses
 */
export type OutputFormat = "json" | "toon";

/**
 * Record structure returned by Dataverse queries
 */
interface DataverseRecord {
  record_id: string;
  deep_link?: string;
  attributes: Record<string, any>;
}

/**
 * Flatten a Dataverse record by merging attributes into the top level.
 * This allows TOON to optimize the repeated attribute keys across records.
 *
 * @param record - The record with nested attributes
 * @returns Flattened record with all attributes at top level
 */
export function flattenRecord(record: DataverseRecord): Record<string, any> {
  return {
    record_id: record.record_id,
    deep_link: record.deep_link,
    ...record.attributes,
  };
}

/**
 * Normalize an array of records so all records have the same keys.
 * TOON only uses tabular format when all records share the same structure.
 * Missing values are set to null to maintain uniform structure.
 *
 * @param records - Array of records that may have different keys
 * @returns Array of records where each has all keys from any record
 */
export function normalizeRecords(
  records: Record<string, any>[],
): Record<string, any>[] {
  if (records.length === 0) {
    return [];
  }

  // Collect all unique keys across all records, preserving order from first occurrence
  const allKeys = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      allKeys.add(key);
    }
  }

  // Convert to array for consistent ordering
  const keyArray = Array.from(allKeys);

  // Normalize each record to have all keys
  return records.map((record) => {
    const normalized: Record<string, any> = {};
    for (const key of keyArray) {
      normalized[key] = key in record ? record[key] : null;
    }
    return normalized;
  });
}

/**
 * Flatten an array of Dataverse records for optimal TOON encoding.
 * Records are flattened (attributes merged to top level) and normalized
 * (all records have the same keys) to enable TOON's tabular format.
 *
 * @param records - Array of records with nested attributes
 * @returns Array of flattened and normalized records
 */
export function flattenRecords(
  records: DataverseRecord[],
): Record<string, any>[] {
  const flattened = records.map(flattenRecord);
  return normalizeRecords(flattened);
}

/**
 * Flatten table attribute metadata for optimal TOON encoding.
 * Complex nested values (like example_value, example_values, option_set, etc.)
 * are stringified as JSON to keep the row structure flat.
 *
 * @param attributes - Array of attribute metadata objects
 * @param complexFields - Field names that should be JSON-stringified (default: common complex fields)
 * @returns Array of flattened attributes suitable for TOON encoding
 */
export function flattenAttributesForToon(
  attributes: Record<string, any>[],
  complexFields: string[] = [
    "example_value",
    "example_values",
    "option_set",
    "boolean_options",
    "lookup_targets",
    "flags",
  ],
): Record<string, any>[] {
  return attributes.map((attr) => {
    const flattened: Record<string, any> = {};
    for (const [key, value] of Object.entries(attr)) {
      if (
        complexFields.includes(key) &&
        value !== null &&
        value !== undefined
      ) {
        // Stringify complex values to keep the row flat
        flattened[key] =
          typeof value === "object" ? JSON.stringify(value) : value;
      } else {
        flattened[key] = value;
      }
    }
    return flattened;
  });
}

/**
 * Pagination information returned with paginated responses
 */
export interface PaginationInfo {
  /** Total number of records available (if known) */
  totalCount?: number;
  /** Number of records returned in this page */
  pageSize: number;
  /** Number of records returned in this response */
  returnedCount: number;
  /** Cursor for fetching the next page (null if no more pages) */
  nextCursor: string | null;
  /** Whether there are more pages available */
  hasMore: boolean;
}

/**
 * Cursor data encoded in pagination cursors
 */
interface CursorData {
  /** Current offset position */
  offset: number;
  /** Page size for consistency */
  pageSize: number;
  /** Optional: table name for context */
  table?: string;
  /** Optional: query identifier for context */
  queryId?: string;
}

/**
 * Format data for MCP tool output based on the specified format.
 *
 * @param data - The data object to format
 * @param format - Output format: 'json' (default) or 'toon'
 * @returns Formatted string representation of the data
 *
 * @example
 * // JSON format (default)
 * formatOutput({ records: [...] }, 'json')
 * // Returns: '{\n  "records": [...]\n}'
 *
 * @example
 * // TOON format (token-efficient)
 * formatOutput({ records: [...] }, 'toon')
 * // Returns: 'records[10]{id,name,status}:\n  1,Alice,Active\n  ...'
 */
export function formatOutput(data: any, format: OutputFormat = "json"): string {
  if (format === "toon") {
    try {
      return toonEncode(data);
    } catch (error) {
      // Fallback to JSON if TOON encoding fails
      console.warn(
        "TOON encoding failed, falling back to JSON:",
        error instanceof Error ? error.message : error,
      );
      return JSON.stringify(data, null, 2);
    }
  }

  return JSON.stringify(data, null, 2);
}

/**
 * Encode pagination cursor data to an opaque string.
 *
 * @param cursorData - The cursor data to encode
 * @returns Base64-encoded cursor string
 */
export function encodeCursor(cursorData: CursorData): string {
  return Buffer.from(JSON.stringify(cursorData)).toString("base64");
}

/**
 * Decode a pagination cursor string back to cursor data.
 *
 * @param cursor - The Base64-encoded cursor string
 * @returns Decoded cursor data, or null if invalid
 */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const data = JSON.parse(decoded);

    // Validate required fields
    if (typeof data.offset !== "number" || typeof data.pageSize !== "number") {
      return null;
    }

    return data as CursorData;
  } catch {
    return null;
  }
}

/**
 * Apply pagination to an array of items and generate pagination info.
 *
 * @param items - The full array of items to paginate
 * @param pageSize - Number of items per page (default: 50)
 * @param cursor - Optional cursor from previous page
 * @param context - Optional context for cursor (table name, query ID)
 * @returns Object containing paginated items and pagination info
 */
export function paginateResults<T>(
  items: T[],
  pageSize: number = 50,
  cursor?: string,
  context?: { table?: string; queryId?: string },
): { items: T[]; pagination: PaginationInfo } {
  let offset = 0;

  // Decode cursor if provided
  if (cursor) {
    const cursorData = decodeCursor(cursor);
    if (cursorData) {
      offset = cursorData.offset;
      // Use page size from cursor for consistency
      pageSize = cursorData.pageSize;
    }
  }

  // Clamp page size to reasonable bounds
  const effectivePageSize = Math.min(Math.max(pageSize, 1), 500);

  // Get the page of items
  const paginatedItems = items.slice(offset, offset + effectivePageSize);
  const hasMore = offset + effectivePageSize < items.length;

  // Generate next cursor if there are more items
  let nextCursor: string | null = null;
  if (hasMore) {
    nextCursor = encodeCursor({
      offset: offset + effectivePageSize,
      pageSize: effectivePageSize,
      table: context?.table,
      queryId: context?.queryId,
    });
  }

  return {
    items: paginatedItems,
    pagination: {
      totalCount: items.length,
      pageSize: effectivePageSize,
      returnedCount: paginatedItems.length,
      nextCursor,
      hasMore,
    },
  };
}

/**
 * Get the format description for tool documentation.
 *
 * @returns Description string for the format parameter
 */
export function getFormatDescription(): string {
  return (
    "Output format: 'json' (default, standard JSON) or 'toon' (Token-Oriented Object Notation, " +
    "30-60% fewer tokens for large result sets). Use 'toon' to reduce token usage when processing many records."
  );
}

/**
 * Get the page size description for tool documentation.
 *
 * @param defaultSize - Default page size value
 * @returns Description string for the pageSize parameter
 */
export function getPageSizeDescription(defaultSize: number = 50): string {
  return `Number of records per page (default: ${defaultSize}, max: 500). Use smaller values to reduce response size.`;
}

/**
 * Get the cursor description for tool documentation.
 *
 * @returns Description string for the cursor parameter
 */
export function getCursorDescription(): string {
  return "Pagination cursor from a previous response's 'next_cursor' field. Omit for first page.";
}
