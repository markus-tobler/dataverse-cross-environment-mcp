import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { Request } from "express";
import { DataverseClient } from "../../services/dataverse/DataverseClient.js";

export interface RequestContextProvider {
  getContext(): Request | undefined;
  getUserInfo(): string;
}

/**
 * Format a detailed, context-aware error message for record create/update operations
 * @param error - The caught error object
 * @param operation - The operation being performed ('create' or 'update')
 * @param params - The parameters from the tool invocation
 * @returns Formatted error message with helpful guidance
 */
function formatRecordOperationError(
  error: any,
  operation: "create" | "update",
  params: { table: string; record_id?: string }
): string {
  // Extract concise error message from verbose API responses
  let errorDetails = error.message || "Unknown error occurred";

  // For Dataverse API errors with verbose stack traces, extract just the key message
  if (errorDetails.includes("Dataverse API request failed")) {
    const match = errorDetails.match(/"message":"([^"]+)"/);
    if (match && match[1]) {
      errorDetails = match[1];
      // Clean up common escape sequences and link references
      errorDetails = errorDetails
        .replace(/\\r\\n/g, " ")
        .replace(/\s+/g, " ")
        .replace(/For more information.*?--+>.*$/, "")
        .replace(/InnerException\s*:\s*\S+\.\S+Exception:\s*/, "")
        .trim();
    } else {
      // Fallback: Extract just the first line if it's a multi-line error
      const lines = errorDetails.split("\n");
      errorDetails = lines[0];
    }
  }

  let helpfulGuidance = "";

  // Lookup resolution errors
  if (errorDetails.includes("Could not resolve lookup value")) {
    const attrMatch = errorDetails.match(/attribute (\w+)/);
    const attribute = attrMatch ? attrMatch[1] : "the lookup field";
    helpfulGuidance =
      `\n\nLookup Field Help for '${attribute}':\n` +
      `Accepted formats:\n` +
      `  - GUID only: "12345678-1234-1234-1234-123456789abc" (for non-polymorphic lookups)\n` +
      `  - Web API style: "accounts(12345678-1234-1234-1234-123456789abc)"\n` +
      `  - Entity/GUID pair: "account=12345678-1234-1234-1234-123456789abc"\n` +
      `  - Primary name: "Contoso Ltd" (must be unique in the target table)\n\n` +
      `Use describe_table_format to see which entity types this lookup can reference and get detailed examples.`;
  }
  // Option set resolution errors
  else if (errorDetails.includes("Could not resolve option set value")) {
    const attrMatch = errorDetails.match(/attribute (\w+)/);
    const attribute = attrMatch ? attrMatch[1] : "the choice field";
    helpfulGuidance =
      `\n\nChoice/Option Set Help for '${attribute}':\n` +
      `Accepted formats:\n` +
      `  - Integer value: 1, 2, 727000000, etc.\n` +
      `  - Label name: "Active", "Inactive", etc. (must be unique)\n\n` +
      `Use describe_table_format to see all available options with their integer values and labels.`;
  }
  // Multiple matches for lookups or option sets
  else if (
    errorDetails.includes("Multiple") &&
    errorDetails.includes("found")
  ) {
    helpfulGuidance =
      `\n\nThe value you provided matches multiple records or options.\n` +
      `Please use a more specific identifier:\n` +
      `  - For lookups: Use the GUID instead of the name\n` +
      `  - For option sets: Use the integer value instead of the label`;
  }
  // Record not found (update only)
  else if (
    operation === "update" &&
    (errorDetails.includes("does not exist") ||
      errorDetails.includes("not found"))
  ) {
    helpfulGuidance =
      `\n\nThe record with ID '${params.record_id}' was not found.\n` +
      `Verify the record ID using search or query tools.`;
  }
  // Required field errors - specific missing attributes validation
  else if (errorDetails.includes("Missing required attributes")) {
    // Our validation already provides detailed guidance, so just pass through
    helpfulGuidance = "";
  }
  // Required field errors - generic
  else if (
    errorDetails.includes("required") ||
    errorDetails.includes("Required")
  ) {
    helpfulGuidance =
      `\n\nA required field is missing or invalid.\n` +
      `Use describe_table_format to see which fields are required and their exact format requirements.`;
  }
  // Data type errors
  else if (errorDetails.includes("type") || errorDetails.includes("invalid")) {
    helpfulGuidance =
      `\n\nData type mismatch detected.\n` +
      `Use describe_table_format to see the expected data types, constraints, and format examples for each field.`;
  }
  // HTTP errors from Dataverse API
  else if (
    errorDetails.includes("400") ||
    errorDetails.includes("Bad Request")
  ) {
    helpfulGuidance =
      `\n\nThe Dataverse API rejected the request.\n` +
      `Common causes:\n` +
      `  - Invalid field names (use describe_table_format to verify)\n` +
      `  - Data type mismatches\n` +
      (operation === "update"
        ? `  - Attempting to update read-only fields\n`
        : `  - Required fields missing\n`) +
      `  - Invalid lookup references`;
  } else if (
    errorDetails.includes("403") ||
    errorDetails.includes("Forbidden")
  ) {
    helpfulGuidance = `\n\nPermission denied. You don't have sufficient privileges to ${operation} ${
      operation === "create" ? "records in" : ""
    } this ${operation === "create" ? "table" : "record"}.`;
  } else if (
    errorDetails.includes("404") ||
    errorDetails.includes("Not Found")
  ) {
    if (operation === "create") {
      helpfulGuidance =
        `\n\nThe table or related record was not found.\n` +
        `  - Verify the table name using list_tables\n` +
        `  - For lookups, ensure the referenced record exists`;
    } else {
      helpfulGuidance =
        `\n\nThe table or record was not found.\n` +
        `  - Verify the table name using list_tables\n` +
        `  - Verify the record ID using search or retrieve_record`;
    }
  }

  const recordInfo =
    operation === "update"
      ? `'${params.record_id}' in table '${params.table}'`
      : `in table '${params.table}'`;

  return `Error ${
    operation === "update" ? "updating" : "creating"
  } record ${recordInfo}:\n\n${errorDetails}${helpfulGuidance}`;
}

export function registerDataverseTools(
  server: McpServer,
  dataverseClient: DataverseClient,
  contextProvider: RequestContextProvider
) {
  server.registerTool(
    "whoami",
    {
      description:
        "Get information about the current authenticated user from Dataverse",
    },
    async (_params: any) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(`Executing WhoAmI tool for user ${userInfo}`);

        const req = contextProvider.getContext();
        const whoAmIResponse = await dataverseClient.whoAmI(req);

        const userPrefix = req
          ? `Authenticated user: ${userInfo}\n\n`
          : "Authenticated user:\n\n";

        const content: any[] = [
          {
            type: "text",
            text: `${userPrefix}User ID: ${whoAmIResponse.UserId}\nBusiness Unit ID: ${whoAmIResponse.BusinessUnitId}\nOrganization ID: ${whoAmIResponse.OrganizationId}`,
          },
        ];

        content.push({
          type: "resource_link",
          uri: `dataverse:///systemusers/${whoAmIResponse.UserId}`,
          name: "Current User",
          description: `System user record for ${userInfo}`,
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.8,
          },
        });

        content.push({
          type: "resource_link",
          uri: `dataverse:///businessunits/${whoAmIResponse.BusinessUnitId}`,
          name: "Current Business Unit",
          description: "Business unit of the current user",
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.5,
          },
        });

        content.push({
          type: "resource_link",
          uri: `dataverse:///organizations/${whoAmIResponse.OrganizationId}`,
          name: "Current Organization",
          description: "Dataverse organization information",
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.5,
          },
        });

        return { content };
      } catch (error) {
        logger.error("Error executing WhoAmI tool:", error);
        throw error;
      }
    }
  );

  server.registerTool(
    "list_tables",
    {
      description:
        "List all available Dataverse tables (entities) with their display names and logical names. This tool provides metadata about tables that can be queried and searched in Dataverse. Use this tool to discover what data is available before performing searches or retrievals.",
    },
    async (_params: any) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(`Executing ListTables tool for user ${userInfo}`);

        const req = contextProvider.getContext();
        const tables = await dataverseClient.listTables(req);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  tables: tables.map((t) => ({
                    logical_name: t.logicalName,
                    display_name: t.displayName,
                    collection_name: t.collectionName,
                    description: t.description,
                  })),
                  count: tables.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing ListTables tool:", error);

        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to retrieve table metadata from Dataverse.`
            : error.name === "Error" &&
              error.message.includes("Dataverse API error")
            ? `Dataverse API error: ${error.message}. This may indicate a connection issue or that the Dataverse instance is unavailable.`
            : `Unexpected error while listing Dataverse tables: ${error.message}. Please check the server logs for more details.`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  error_type: error.name,
                  message: errorMessage,
                  details: error.message,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "search",
    {
      description:
        "Search for records using keyword searches across Dataverse tables. Best for finding records by text content. Don't use for filtering or listing records. For filter, use 'run_predefined_query' or 'run_custom_query'. Returns a list of matching records with their record_id (primary GUID), primary name, and important attributes. NOTE: For listing or retrieving multiple records, check 'get_predefined_queries' first to see if a suitable view exists - predefined queries are more efficient for structured data retrieval. Use 'run_custom_query' for filtered searches with specific criteria. To discover available tables, use the 'list_tables' tool first.",
      inputSchema: {
        searchTerm: z
          .string()
          .describe("The search term to find in Dataverse records"),
        tableFilter: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "Optional: Table name(s) to search within - can be logical name (e.g., 'salesorder') or entity set name (e.g., 'salesorders'). Accepts a single table name or an array like ['account', 'contact']. If not provided, searches across all enabled tables. When specified, returns only important columns for better performance."
          ),
        top: z
          .number()
          .optional()
          .describe(
            "Optional: Maximum number of results to return (default: 50)"
          ),
      },
    },
    async (params: {
      searchTerm: string;
      tableFilter?: string | string[];
      top?: number;
    }) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        const filterDisplay = params.tableFilter
          ? Array.isArray(params.tableFilter)
            ? params.tableFilter.join(", ")
            : params.tableFilter
          : "none";

        logger.info(
          `Executing Search tool for user ${userInfo} with term '${params.searchTerm}' and filter '${filterDisplay}'`
        );

        const req = contextProvider.getContext();
        const searchResponse = await dataverseClient.search(
          params.searchTerm,
          params.tableFilter,
          params.top || 10,
          req
        );

        const content: any[] = [
          {
            type: "text",
            text: JSON.stringify(
              {
                search_term: params.searchTerm,
                table_filter: params.tableFilter,
                total_record_count: searchResponse.totalRecordCount,
                results: searchResponse.results.map((r) => ({
                  table_name: r.tableName,
                  record_id: r.recordId,
                  primary_name: r.primaryName,
                  deep_link: r.deepLink,
                  attributes: r.attributes,
                })),
              },
              null,
              2
            ),
          },
        ];

        searchResponse.results.forEach((r) => {
          content.push({
            type: "resource_link",
            uri: `dataverse:///${r.tableName}/${r.recordId}`,
            name: r.primaryName || r.recordId,
            description: `${r.tableName} record`,
            mimeType: "application/json",
            annotations: {
              audience: ["assistant"],
              priority: 0.8,
            },
          });
        });

        return { content };
      } catch (error: any) {
        logger.error("Error executing Search tool:", error);

        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to perform searches in Dataverse.`
            : error.message?.includes("Search feature is disabled") ||
              error.message?.includes("not enabled")
            ? "Dataverse Search is not enabled for this organization. Please contact your administrator to enable Dataverse Search in the Power Platform admin center."
            : error.name === "ArgumentError"
            ? `Invalid parameter: ${error.message}. Please check that the search term and table filter (if provided) are valid.`
            : `Unexpected error while searching Dataverse: ${error.message}. Please check the server logs for more details.`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  error_type: error.name,
                  message: errorMessage,
                  search_term: params.searchTerm,
                  table_filter: params.tableFilter,
                  details: error.message,
                  suggestion:
                    "To discover available tables, use the 'list_tables' tool. To check if search is enabled, contact your administrator.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "retrieve_record",
    {
      description:
        "Retrieve a single record from Dataverse by its unique record_id (GUID) or primary name value. By default, returns only the most important attributes for better performance and readability. Use 'allColumns: true' to retrieve all available columns. The record_id (GUID) is the preferred identifier and is typically obtained from the 'search' or query tool results. When using primary name, the tool will fail if multiple records with the same name are found - use the GUID instead in such cases.",
      inputSchema: {
        tableName: z
          .string()
          .describe(
            "The logical name of the table (e.g., 'account', 'contact')"
          ),
        recordId: z
          .string()
          .describe(
            "The record_id (unique GUID identifier) of the record to retrieve (e.g., '12345678-1234-1234-1234-123456789abc'), OR the primary name value (e.g., 'Contoso Ltd'). GUID is preferred for uniqueness."
          ),
        allColumns: z
          .boolean()
          .optional()
          .describe(
            "Optional: If true, retrieve all columns; if false, retrieve only important columns (default: false)"
          ),
      },
    },
    async (params: {
      tableName: string;
      recordId: string;
      allColumns?: boolean;
    }) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing RetrieveRecord tool for user ${userInfo} - Table: ${
            params.tableName
          }, RecordId: ${params.recordId}, AllColumns: ${
            params.allColumns || false
          }`
        );

        const req = contextProvider.getContext();
        // DataverseClient.retrieveRecord now handles resolution internally
        const record = await dataverseClient.retrieveRecord(
          params.tableName,
          params.recordId,
          req,
          params.allColumns || false
        );

        const content: any[] = [
          {
            type: "text",
            text: JSON.stringify(
              {
                table_name: params.tableName,
                record_id: params.recordId,
                resource_uri: `dataverse:///${params.tableName}/${params.recordId}`,
                deep_link: record._deepLink,
                attributes: record,
              },
              null,
              2
            ),
          },
        ];

        content.push({
          type: "resource_link",
          uri: `dataverse:///${params.tableName}/${params.recordId}`,
          name: `${params.tableName} - ${params.recordId}`,
          description: `Full record from ${params.tableName} table`,
          mimeType: "application/json",
          annotations: {
            audience: ["assistant"],
            priority: 0.9,
          },
        });

        Object.keys(record).forEach((key) => {
          if (key.startsWith("_") && key.endsWith("_value")) {
            const lookupId = record[key];
            const navigationProperty = key.substring(1, key.length - 6);
            const navPropKey = `${navigationProperty}@odata.bind`;
            if (record[navPropKey]) {
              const odataValue = record[navPropKey] as string;
              const match = odataValue.match(/^([^(]+)\(/);
              if (match) {
                const entitySetName = match[1];
                content.push({
                  type: "resource_link",
                  uri: `dataverse:///${entitySetName}/${lookupId}`,
                  name: `Related ${navigationProperty}`,
                  description: `Lookup reference from ${params.tableName}`,
                  mimeType: "application/json",
                  annotations: {
                    audience: ["assistant"],
                    priority: 0.7,
                  },
                });
              }
            }
          }
        });

        return { content };
      } catch (error: any) {
        logger.error("Error executing RetrieveRecord tool:", error);

        if (error.message.includes("Invalid record ID format")) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: true,
                    error_type: "ArgumentError",
                    message: `Invalid parameter: ${error.message}`,
                    table_name: params.tableName,
                    record_id: params.recordId,
                    suggestion:
                      "Ensure the record_id is a valid GUID format (e.g., '12345678-1234-1234-1234-123456789abc').",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to retrieve records from the '${params.tableName}' table.`
            : error.message?.includes("404") ||
              error.message?.includes("Not Found")
            ? `Record not found: The record with record_id '${params.recordId}' does not exist in the '${params.tableName}' table, or the current user does not have permission to view it.`
            : error.message?.includes("400")
            ? `Bad request: Invalid table name '${params.tableName}' or malformed request. Use the 'list_tables' tool to see available tables.`
            : `Unexpected error while retrieving record: ${error.message}. Please check the server logs for more details.`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  error_type: error.name,
                  message: errorMessage,
                  table_name: params.tableName,
                  record_id: params.recordId,
                  details: error.message,
                  suggestion:
                    "Use the 'search' tool to find valid record_id values, or use the 'list_tables' tool to verify the table name.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "describe_table",
    {
      description:
        "Get a detailed description of a Dataverse table including its schema, important fields, data types, and synthetic example data. Use this tool after 'list_tables' to understand the structure and available columns of a table before querying or analyzing data. By default, returns only the most important fields determined by analyzing recent records and metadata. Use the 'full' parameter to get all attributes. The results include field types, constraints, and example values to help you understand the data format. Results are cached for 24 hours for better performance.",
      inputSchema: {
        tableName: z
          .string()
          .describe(
            "The logical name or entity set name of the table (e.g., 'account', 'contact', 'accounts')"
          ),
        full: z
          .boolean()
          .optional()
          .describe(
            "If true, return all attributes; if false, return only important fields based on recent data analysis (default: false)"
          ),
      },
    },
    async (params: { tableName: string; full?: boolean }) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing DescribeTable tool for user ${userInfo} - Table: ${
            params.tableName
          }, Full: ${params.full || false}`
        );

        const req = contextProvider.getContext();
        // DataverseClient.describeTable now handles resolution internally
        const description = await dataverseClient.describeTable(
          params.tableName,
          params.full || false,
          req
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  table: {
                    logical_name: description.logicalName,
                    display_name: description.displayName,
                    description: description.description,
                    primary_id_attribute: description.primaryIdAttribute,
                    primary_name_attribute: description.primaryNameAttribute,
                  },
                  attributes: description.attributes.map((attr) => ({
                    logical_name: attr.logicalName,
                    display_name: attr.displayName,
                    description: attr.description,
                    type: attr.type,
                    is_primary_id: attr.isPrimaryId,
                    is_primary_name: attr.isPrimaryName,
                    is_required: attr.isRequired,
                    is_read_only: attr.isReadOnly,
                    max_length: attr.maxLength,
                    format: attr.format,
                    example_value: attr.exampleValue,
                  })),
                  sample_record: description.sampleRecord,
                  attribute_count: description.attributes.length,
                  mode: params.full ? "full" : "important fields only",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing DescribeTable tool:", error);

        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to access table metadata.`
            : error.message?.includes("does not exist") ||
              error.message?.includes("not found")
            ? `Table '${params.tableName}' not found. Use the 'list_tables' tool to see available tables.`
            : `Unexpected error while describing table: ${error.message}. Please check the server logs for more details.`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  error_type: error.name,
                  message: errorMessage,
                  details: error.message,
                  table_name: params.tableName,
                  suggestion:
                    "Use the 'list_tables' tool to verify the table name exists, or check if you have permissions to access this table.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "describe_table_format",
    {
      description:
        "Get comprehensive format information for creating valid records in a Dataverse table. This tool is specifically designed for LLM agents and provides detailed metadata about field types, option sets (choices), boolean values, lookup targets, and constraints. Use this tool BEFORE attempting to create or update records to understand the exact format requirements and valid values for each field. The response includes detailed guidance on how to format lookups, option sets, booleans, and other field types, along with multiple example values for each field.",
      inputSchema: {
        tableName: z
          .string()
          .describe(
            "The logical name or entity set name of the table (e.g., 'account', 'contact', 'accounts')"
          ),
      },
    },
    async (params: { tableName: string }) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing DescribeTableFormat tool for user ${userInfo} - Table: ${params.tableName}`
        );

        const req = contextProvider.getContext();
        // DataverseClient.describeTableFormat now handles resolution internally
        const formatDescription = await dataverseClient.describeTableFormat(
          params.tableName,
          req
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  table: {
                    logical_name: formatDescription.logicalName,
                    display_name: formatDescription.displayName,
                    description: formatDescription.description,
                    primary_id_attribute: formatDescription.primaryIdAttribute,
                    primary_name_attribute:
                      formatDescription.primaryNameAttribute,
                  },
                  required_attributes: formatDescription.requiredAttributes,
                  creation_guidance: formatDescription.creationGuidance,
                  attributes: formatDescription.attributes.map((attr) => ({
                    logical_name: attr.logicalName,
                    display_name: attr.displayName,
                    description: attr.description,
                    type: attr.type,
                    is_primary_id: attr.isPrimaryId,
                    is_primary_name: attr.isPrimaryName,
                    is_required: attr.isRequired,
                    is_read_only: attr.isReadOnly,
                    is_valid_for_create: attr.isValidForCreate,
                    is_valid_for_update: attr.isValidForUpdate,
                    max_length: attr.maxLength,
                    min_value: attr.minValue,
                    max_value: attr.maxValue,
                    precision: attr.precision,
                    format: attr.format,
                    option_set: attr.optionSet,
                    boolean_options: attr.booleanOptions,
                    lookup_targets: attr.lookupTargets,
                    format_guidance: attr.formatGuidance,
                    example_values: attr.exampleValues,
                  })),
                  attribute_count: formatDescription.attributes.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing DescribeTableFormat tool:", error);

        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to access table metadata.`
            : error.message?.includes("does not exist") ||
              error.message?.includes("not found")
            ? `Table '${params.tableName}' not found. Use the 'list_tables' tool to see available tables.`
            : `Unexpected error while describing table format: ${error.message}. Please check the server logs for more details.`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  error_type: error.name,
                  message: errorMessage,
                  details: error.message,
                  table_name: params.tableName,
                  suggestion:
                    "Use the 'list_tables' tool to verify the table name exists, or check if you have permissions to access this table.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "get_predefined_queries",
    {
      description:
        "Get a list of predefined queries, aka views (savedqueries and userqueries) for a specific Dataverse table. RECOMMENDED: Use this tool first when you need to list or retrieve multiple records - predefined queries are optimized for structured data retrieval and often provide exactly what you need. Each view includes its ID, type (savedquery or userquery), and name. Use 'run_predefined_query' to execute a view you find here.",
      inputSchema: {
        tableName: z
          .string()
          .describe(
            "The logical name of the table to get views for (e.g., 'account', 'contact')"
          ),
      },
    },
    async (params: { tableName: string }) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing GetPredefinedQueries tool for user ${userInfo} - Table: ${params.tableName}`
        );

        const req = contextProvider.getContext();
        const queries = await dataverseClient.getPredefinedQueries(
          params.tableName,
          req
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  table_name: params.tableName,
                  queries: queries.map((q) => ({
                    id: q.id,
                    type: q.type,
                    name: q.name,
                  })),
                  count: queries.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing GetPredefinedQueries tool:", error);

        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to retrieve query definitions from the '${params.tableName}' table.`
            : error.message?.includes("does not exist") ||
              error.message?.includes("not found")
            ? `Table '${params.tableName}' not found. Use the 'list_tables' tool to see available tables.`
            : `Unexpected error while retrieving predefined queries: ${error.message}. Please check the server logs for more details.`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  error_type: error.name,
                  message: errorMessage,
                  table_name: params.tableName,
                  details: error.message,
                  suggestion:
                    "Use the 'list_tables' tool to verify the table name exists, or check if you have permissions to access this table.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "run_predefined_query",
    {
      description:
        "Execute a predefined Dataverse query (savedquery or userquery) to list or retrieve multiple records. RECOMMENDED for structured data retrieval - use this and not search when you need to list records with specific filters or views. Returns the query results including each record's record_id (primary GUID), all record attributes, resource links, and deep links (for opening records in Dataverse UI). Use 'get_predefined_queries' first to discover available queries and their IDs.",
      inputSchema: {
        queryIdOrName: z
          .string()
          .describe(
            "The query ID (GUID) or query name to execute. GUID is preferred for uniqueness."
          ),
        tableName: z
          .string()
          .optional()
          .describe(
            "Optional: The logical name of the table (required only when querying by name instead of ID)"
          ),
      },
    },
    async (params: { queryIdOrName: string; tableName?: string }) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing RunPredefinedQuery tool for user ${userInfo} - Query: ${
            params.queryIdOrName
          }, Table: ${params.tableName || "auto-detect"}`
        );

        const req = contextProvider.getContext();
        const result = await dataverseClient.runPredefinedQuery(
          params.queryIdOrName,
          params.tableName,
          req
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: params.queryIdOrName,
                  table_name: result.tableName,
                  total_record_count: result.totalRecordCount,
                  records: result.records.map((r) => ({
                    record_id: r.recordId,
                    deep_link: r.deepLink,
                    attributes: r.attributes,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing RunPredefinedQuery tool:", error);

        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to execute queries.`
            : error.message?.includes("not found")
            ? `Query '${params.queryIdOrName}' not found. ${
                params.tableName
                  ? `Ensure the query exists for table '${params.tableName}'.`
                  : "Provide the tableName parameter if querying by name."
              }`
            : error.message?.includes("Table name is required")
            ? `Table name is required when querying by name instead of ID. Please provide the 'tableName' parameter.`
            : `Unexpected error while running predefined query: ${error.message}. Please check the server logs for more details.`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  error_type: error.name,
                  message: errorMessage,
                  query: params.queryIdOrName,
                  table_name: params.tableName,
                  details: error.message,
                  suggestion:
                    "Use the 'get_predefined_queries' tool to discover available queries and their IDs.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "run_custom_query",
    {
      description:
        "Execute a custom FetchXML query for complex filtered searches with specific criteria. Use this when predefined queries don't meet your needs and you need advanced filtering, joins, or aggregations. FetchXML is the query language used by Dataverse to retrieve data. Returns the query results including each record's record_id (primary GUID), all record attributes, resource links, and deep links (for opening records in Dataverse UI). NOTE: Check 'get_predefined_queries' first - a predefined query may already exist for your use case. Provides detailed error messages if the FetchXML syntax is invalid or references non-existent entities/attributes, so you can refine your query accordingly.",
      inputSchema: {
        fetchXml: z
          .string()
          .describe(
            "The FetchXML query to execute. Must be valid FetchXML with correct entity and attribute names."
          ),
        tableName: z
          .string()
          .optional()
          .describe(
            "Optional: The logical name of the table (if not specified in the FetchXML <entity> tag)"
          ),
      },
    },
    async (params: { fetchXml: string; tableName?: string }) => {
      try {
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing RunCustomQuery tool for user ${userInfo} - Table: ${
            params.tableName || "from FetchXML"
          }`
        );

        const req = contextProvider.getContext();
        const result = await dataverseClient.runCustomQuery(
          params.fetchXml,
          params.tableName,
          req
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  table_name: result.tableName,
                  total_record_count: result.totalRecordCount,
                  records: result.records.map((r) => ({
                    record_id: r.recordId,
                    deep_link: r.deepLink,
                    attributes: r.attributes,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing RunCustomQuery tool:", error);

        // Extract Dataverse service error details if available
        let dataverseErrorDetails = null;
        if (error.message?.includes("Dataverse API request failed")) {
          // Try to parse the error response from Dataverse
          const errorMatch = error.message.match(
            /Dataverse API request failed with status (\d+): (.+)/
          );
          if (errorMatch) {
            try {
              const errorBody = JSON.parse(errorMatch[2]);
              dataverseErrorDetails = errorBody;
            } catch {
              // If not JSON, keep the raw error text
              dataverseErrorDetails = errorMatch[2];
            }
          }
        }

        // Provide detailed FetchXML error messages
        const errorMessage =
          error.name === "Error" &&
          error.message.includes("Configuration error")
            ? `Configuration error: ${error.message}. Please verify that the Dataverse instance URL is correctly configured.`
            : error.name === "Error" &&
              error.message.includes("Authentication error")
            ? `Authentication error: ${error.message}. The current user may not have permission to execute queries.`
            : error.message?.includes("Invalid FetchXML")
            ? `Invalid FetchXML query: ${error.message}`
            : error.message?.includes("Could not determine table name")
            ? `Could not determine table name from FetchXML. Please provide the 'tableName' parameter or include an <entity name="..."> tag in your FetchXML.`
            : error.message?.includes("does not exist") ||
              error.message?.includes("not found")
            ? `Entity or attribute not found: ${error.message}. Verify all entity and attribute names in your FetchXML are correct.`
            : `Unexpected error executing FetchXML query: ${error.message}. Please check the server logs for more details.`;

        const responseContent: any = {
          error: true,
          error_type: error.name,
          message: errorMessage,
          details: error.message,
          fetchxml_provided: params.fetchXml.substring(0, 200) + "...",
          suggestion:
            "Verify your FetchXML syntax, entity names, and attribute names. Use the 'describe_table' tool to see available attributes for a table.",
        };

        // Include Dataverse service error details if available
        if (dataverseErrorDetails) {
          responseContent.dataverse_error = dataverseErrorDetails;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responseContent, null, 2),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "create_record",
    {
      description:
        "Create a new record in a Dataverse table. IMPORTANT: Use describe_table_format first to understand the exact format requirements for each field including valid option set values, lookup targets, and data type constraints. This will ensure you provide correctly formatted data.",
      inputSchema: z.object({
        table: z
          .string()
          .describe("The logical name of the table to create the record in."),
        data: z
          .object({})
          .passthrough()
          .describe("A JSON object containing the data for the new record."),
      }),
    },
    async (params: any) => {
      try {
        const { table, data } = params;
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing CreateRecord tool for user ${userInfo} on table ${table}`
        );

        const req = contextProvider.getContext();
        const recordId = await dataverseClient.createRecord(table, data, req);

        return {
          content: [
            {
              type: "text",
              text: `Successfully created record with ID: ${recordId}`,
            },
            {
              type: "resource_link",
              uri: `dataverse:///${table}/${recordId}`,
              name: "Created Record",
              description: `The newly created record in ${table}`,
              mimeType: "application/json",
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing CreateRecord tool:", error);
        return {
          content: [
            {
              type: "text",
              text: formatRecordOperationError(error, "create", params),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "update_record",
    {
      description:
        "Update an existing record in a Dataverse table. IMPORTANT: Use describe_table_format first to understand the exact format requirements for each field including valid option set values, lookup targets, and data type constraints. This will ensure you provide correctly formatted data.",
      inputSchema: z.object({
        table: z
          .string()
          .describe("The logical name of the table to update the record in."),
        record_id: z.string().describe("The ID of the record to update."),
        data: z
          .object({})
          .passthrough()
          .describe(
            "A JSON object containing the data to update on the record."
          ),
      }),
    },
    async (params: any) => {
      try {
        const { table, record_id, data } = params;
        const userInfo = contextProvider.getUserInfo();
        logger.info(
          `Executing UpdateRecord tool for user ${userInfo} on table ${table} and record ${record_id}`
        );

        const req = contextProvider.getContext();
        await dataverseClient.updateRecord(table, record_id, data, req);

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated record with ID: ${record_id}`,
            },
            {
              type: "resource_link",
              uri: `dataverse:///${table}/${record_id}`,
              name: "Updated Record",
              description: `The updated record in ${table}`,
              mimeType: "application/json",
            },
          ],
        };
      } catch (error: any) {
        logger.error("Error executing UpdateRecord tool:", error);
        return {
          content: [
            {
              type: "text",
              text: formatRecordOperationError(error, "update", params),
            },
          ],
        };
      }
    }
  );
}
