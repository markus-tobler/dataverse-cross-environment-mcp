/**
 * Utility functions for GUID validation and handling
 */

/**
 * Regular expression pattern for validating GUIDs in the format:
 * 8 hexadecimal digits - 4 hex digits - 4 hex digits - 4 hex digits - 12 hex digits
 * Example: 12345678-1234-1234-1234-123456789abc
 * Case-insensitive matching
 */
export const GUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks if a string is a valid GUID
 * @param value - The string to validate
 * @returns true if the string is a valid GUID, false otherwise
 */
export function isGuid(value: string): boolean {
  return GUID_REGEX.test(value);
}

/**
 * Escapes a value for use in OData filter queries
 * Single quotes are escaped by doubling them as per OData specification
 * @param value - The value to escape
 * @returns The escaped value safe for use in OData filters
 */
export function escapeODataValue(value: string): string {
  return value.replace(/'/g, "''");
}
