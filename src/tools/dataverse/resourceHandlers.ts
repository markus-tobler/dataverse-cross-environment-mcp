import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Request } from "express";
import { DataverseClient } from "../../services/dataverse/DataverseClient.js";
import { logger } from "../../utils/logger.js";
import { isGuid } from "../../utils/guidUtils.js";

export interface RequestContextProvider {
  getContext(): Request | undefined;
  getUserInfo(): string;
}

export function registerDataverseResourceHandlers(
  server: McpServer,
  dataverseClient: DataverseClient,
  contextProvider: RequestContextProvider
) {
  server.server.registerCapabilities({
    resources: {},
  });

  server.server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request) => {
      const uri = request.params.uri;

      logger.info(`Reading resource: ${uri}`);

      try {
        const match = uri.match(/^dataverse:\/\/\/([^/]+)\/(.+)$/);
        if (!match) {
          throw new Error(
            `Invalid resource URI format: ${uri}. Expected format: dataverse:///tableName/record_id`
          );
        }

        const [, tableName, recordId] = match;

        if (!isGuid(recordId)) {
          throw new Error(
            `Invalid record_id format in URI: ${recordId}. Must be a valid GUID.`
          );
        }

        logger.info(
          `Retrieving resource for table: ${tableName}, record: ${recordId}`
        );

        const req = contextProvider.getContext();
        const record = await dataverseClient.retrieveRecord(
          tableName,
          recordId,
          req,
          false
        );

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(record, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error(`Error reading resource ${uri}:`, error);
        throw new Error(`Failed to read resource ${uri}: ${error.message}`);
      }
    }
  );
}
