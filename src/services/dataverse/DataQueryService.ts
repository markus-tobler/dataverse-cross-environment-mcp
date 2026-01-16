import {
  SearchResponse,
  PredefinedQuery,
  QueryResult,
  QueryRecord,
} from "../../types/dataverse.js";
import { DataverseWebApiService } from "./DataverseWebApiService.js";
import { MetadataService } from "./MetadataService.js";
import { logger } from "../../utils/logger.js";
import { isGuid, escapeODataValue } from "../../utils/guidUtils.js";

/**
 * Service for querying data from Dataverse
 * Handles search, retrieve, and query operations
 */
export class DataQueryService {
  private metadataService: MetadataService;

  constructor(metadataService: MetadataService) {
    this.metadataService = metadataService;
  }

  getDeepLinkUrl(
    dataverseUrl: string,
    tableName: string,
    recordId: string
  ): string {
    const orgUrl = dataverseUrl
      .replace(/\/api\/data\/v[0-9.]+\/?$/, "")
      .replace(/\/$/, "");
    return `${orgUrl}/main.aspx?etn=${tableName}&pagetype=entityrecord&id=${recordId}`;
  }

  /**
   * Search for records using Dataverse Search API
   * @param service - The Dataverse Web API service
   * @param searchTerm - The text to search for
   * @param tableFilter - Optional table name(s) to filter search. Accepts logical names or entity set names (resolved internally)
   * @param top - Maximum number of results to return
   * @note This method handles resolution internally because tableFilter can be an array
   */
  async search(
    service: DataverseWebApiService,
    searchTerm: string,
    tableFilter?: string | string[],
    top: number = 10
  ): Promise<SearchResponse> {
    const accessToken = await service.getAccessTokenFunc()();

    let searchRequestBody: any;

    if (tableFilter) {
      const tables = Array.isArray(tableFilter) ? tableFilter : [tableFilter];
      const searchEntities = [];

      for (const table of tables) {
        // Resolve logical name first (handles both logical names and entity set names)
        const logicalName = await this.metadataService.resolveLogicalName(
          service,
          table
        );

        const importantColumns =
          await this.metadataService.getImportantColumnsForTable(
            service,
            logicalName
          );

        const searchEntity: any = {
          name: logicalName,
          selectcolumns: importantColumns.length > 0 ? importantColumns : null,
          searchcolumns: null,
          filter: null,
        };

        searchEntities.push(searchEntity);
      }

      searchRequestBody = {
        search: searchTerm,
        top: top,
        entities: JSON.stringify(searchEntities),
      };
    } else {
      searchRequestBody = {
        search: searchTerm,
        top: top,
      };
    }

    logger.debug(
      `Executing search with term: '${searchTerm}', tableFilter: '${
        tableFilter || "none"
      }', top: ${top}`
    );
    logger.debug(
      `Search request body: ${JSON.stringify(searchRequestBody, null, 2)}`
    );

    try {
      const response = await service.sendRequestString(
        accessToken,
        "POST",
        "searchquery",
        searchRequestBody
      );

      const responseData = JSON.parse(response);

      if (!responseData.response) {
        return { results: [], totalRecordCount: 0 };
      }

      const searchResults = JSON.parse(responseData.response);

      if (!searchResults.Value) {
        return { results: [], totalRecordCount: 0 };
      }

      const results = searchResults.Value.map((r: any) => {
        let primaryName = "";
        if (r.Attributes) {
          const attrs = Object.entries(r.Attributes);
          const nameAttr = attrs.find(
            ([key]) => key !== "@search.objecttypecode"
          );
          if (nameAttr) {
            primaryName = String(nameAttr[1] || "");
          }
        }

        const tableName = r.EntityName || "";
        const recordId = r.Id || "";

        return {
          tableName,
          recordId,
          primaryName,
          attributes: r.Attributes || {},
          deepLink: this.getDeepLinkUrl(
            service.getDataverseUrl(),
            tableName,
            recordId
          ),
        };
      });

      return {
        results: results,
        totalRecordCount: searchResults.Count || 0,
      };
    } catch (error: any) {
      logger.error("Error executing search query:", error);
      throw error;
    }
  }

  /**
   * Retrieve a single record from a Dataverse table
   * @param service - The Dataverse Web API service
   * @param logicalName - The logical name of the table (e.g., 'salesorder', NOT 'salesorders')
   * @param recordId - The ID of the record to retrieve
   * @param allColumns - If true, return all columns; otherwise return only important columns
   */
  async retrieveRecord(
    service: DataverseWebApiService,
    logicalName: string,
    recordId: string,
    allColumns: boolean = false
  ): Promise<Record<string, any>> {
    const accessToken = await service.getAccessTokenFunc()();

    try {
      const entitySetName = await this.metadataService.getEntitySetName(
        service,
        logicalName
      );

      let selectClause = "*";

      if (!allColumns) {
        const importantColumnNames =
          await this.metadataService.getImportantColumnsForTable(
            service,
            logicalName
          );
        if (importantColumnNames.length > 0) {
          selectClause = importantColumnNames.join(",");
        }
      }

      // Check if recordId is a GUID or a primary name value
      const isGuidValue = isGuid(recordId);

      let url: string;
      let tableDescription;

      if (isGuidValue) {
        // Direct lookup by GUID
        url = `${entitySetName}(${recordId})?$select=${selectClause}`;
      } else {
        // Lookup by primary name - need to get the primary name attribute first
        tableDescription = await this.metadataService.describeTable(
          service,
          logicalName,
          false
        );
        const primaryNameAttribute = tableDescription.primaryNameAttribute;

        if (!primaryNameAttribute) {
          throw new Error(
            `Table '${logicalName}' does not have a primary name attribute. Please use the GUID to retrieve records.`
          );
        }

        // Query by primary name attribute with proper escaping
        const escapedValue = escapeODataValue(recordId);
        url = `${entitySetName}?$filter=${primaryNameAttribute} eq '${escapedValue}'&$select=${selectClause}&$top=2`;
      }

      const response = await service.sendRequestString(
        accessToken,
        "GET",
        url,
        undefined,
        {
          Prefer:
            'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
        }
      );

      const data = JSON.parse(response);

      if (!isGuidValue) {
        // When querying by name, we get an array response
        if (!tableDescription) {
          throw new Error(
            `Internal error: tableDescription is not available when querying by name`
          );
        }

        if (!data.value || data.value.length === 0) {
          throw new Error(
            `No record found with ${tableDescription.primaryNameAttribute} = '${recordId}' in table '${logicalName}'`
          );
        }
        if (data.value.length > 1) {
          throw new Error(
            `Multiple records found with ${tableDescription.primaryNameAttribute} = '${recordId}' in table '${logicalName}'. Please use the unique GUID instead.`
          );
        }
        return data.value[0] || {};
      }

      return data || {};
    } catch (error: any) {
      logger.error(
        `Error retrieving record ${recordId} from table ${logicalName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get predefined queries (savedqueries and userqueries) for a table
   */
  async getPredefinedQueries(
    service: DataverseWebApiService,
    tableName: string
  ): Promise<PredefinedQuery[]> {
    const logicalName = await this.metadataService.resolveLogicalName(
      service,
      tableName
    );
    const accessToken = await service.getAccessTokenFunc()();

    try {
      const queries: PredefinedQuery[] = [];

      // Get current user ID to resolve roles for role-aware filtering
      const whoAmIText = await service.sendRequestString(
        accessToken,
        "GET",
        `WhoAmI`,
        undefined
      );
      const whoAmI = JSON.parse(whoAmIText);
      const currentUserId: string | undefined = whoAmI?.UserId;

      // Fetch user's roles via association; if fails, proceed without role filtering
      let userRoleIds: Set<string> = new Set<string>();
      if (currentUserId) {
        try {
          const rolesText = await service.sendRequestString(
            accessToken,
            "GET",
            `systemusers(${currentUserId})/systemuserroles_association?$select=roleid,name`,
            undefined
          );
          const rolesData = JSON.parse(rolesText);
          const values = Array.isArray(rolesData?.value) ? rolesData.value : [];
          values.forEach((r: any) => {
            if (r?.roleid) userRoleIds.add(String(r.roleid).toLowerCase());
          });
        } catch (e) {
          // Ignore errors and continue without role-based filtering
        }
      }

      // Fetch savedqueries (system views)
      const savedQueryResponse = await service.sendRequestString(
        accessToken,
        "GET",
        `savedqueries?$filter=returnedtypecode eq '${logicalName}' and statecode eq 0&$select=savedqueryid,name,returnedtypecode,roledisplayconditionsxml`,
        undefined
      );

      const savedQueryData = JSON.parse(savedQueryResponse);
      if (savedQueryData.value && Array.isArray(savedQueryData.value)) {
        savedQueryData.value.forEach((query: any) => {
          const xml: string | undefined = query?.roledisplayconditionsxml;
          let include = true;
          if (xml && userRoleIds.size > 0) {
            // Extract any GUIDs from XML and require intersection with user roles
            const guids = Array.from(
              new Set(
                (
                  xml.match(
                    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g
                  ) || []
                ).map((g) => g.toLowerCase())
              )
            );
            if (guids.length > 0) {
              include = guids.some((g) => userRoleIds.has(g));
            }
          }
          if (include) {
            queries.push({
              id: query.savedqueryid,
              type: "savedquery",
              name: query.name || "Unnamed View",
            });
          }
        });
      }

      // Fetch userqueries (personal views)
      const userQueryResponse = await service.sendRequestString(
        accessToken,
        "GET",
        `userqueries?$filter=returnedtypecode eq '${logicalName}' and statecode eq 0&$select=userqueryid,name,returnedtypecode`,
        undefined
      );

      const userQueryData = JSON.parse(userQueryResponse);
      if (userQueryData.value && Array.isArray(userQueryData.value)) {
        userQueryData.value.forEach((query: any) => {
          queries.push({
            id: query.userqueryid,
            type: "userquery",
            name: query.name || "Unnamed Personal View",
          });
        });
      }

      logger.info(
        `Found ${queries.length} predefined queries for table ${logicalName}`
      );
      return queries;
    } catch (error: any) {
      logger.error(
        `Error fetching predefined queries for table ${logicalName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Run a predefined query by ID or name
   */
  async runPredefinedQuery(
    service: DataverseWebApiService,
    queryIdOrName: string,
    tableName?: string
  ): Promise<QueryResult> {
    const accessToken = await service.getAccessTokenFunc()();

    try {
      // Determine if this is a GUID or a name
      const isGuidValue = isGuid(queryIdOrName);

      let fetchXml: string;
      let returnedTypeCode: string;

      if (isGuidValue) {
        // Try to fetch from savedquery first
        try {
          const savedQueryResponse = await service.sendRequestString(
            accessToken,
            "GET",
            `savedqueries(${queryIdOrName})?$select=fetchxml,returnedtypecode`,
            undefined
          );
          const savedQueryData = JSON.parse(savedQueryResponse);
          fetchXml = savedQueryData.fetchxml;
          returnedTypeCode = savedQueryData.returnedtypecode;
        } catch (savedQueryError: any) {
          // If not found in savedquery, try userquery
          if (
            savedQueryError.message?.includes("404") ||
            savedQueryError.message?.includes("Not Found")
          ) {
            const userQueryResponse = await service.sendRequestString(
              accessToken,
              "GET",
              `userqueries(${queryIdOrName})?$select=fetchxml,returnedtypecode`,
              undefined
            );
            const userQueryData = JSON.parse(userQueryResponse);
            fetchXml = userQueryData.fetchxml;
            returnedTypeCode = userQueryData.returnedtypecode;
          } else {
            throw savedQueryError;
          }
        }
      } else {
        // Search by name
        if (!tableName) {
          throw new Error(
            "Table name is required when querying by name instead of ID"
          );
        }

        const logicalName = await this.metadataService.resolveLogicalName(
          service,
          tableName
        );

        // Escape the query name for OData filter
        const escapedQueryName = escapeODataValue(queryIdOrName);

        // Try savedquery first
        const savedQueryResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `savedqueries?$filter=name eq '${escapedQueryName}' and returnedtypecode eq '${logicalName}'&$select=savedqueryid,fetchxml,returnedtypecode`,
          undefined
        );
        const savedQueryData = JSON.parse(savedQueryResponse);

        if (savedQueryData.value && savedQueryData.value.length > 0) {
          fetchXml = savedQueryData.value[0].fetchxml;
          returnedTypeCode = savedQueryData.value[0].returnedtypecode;
        } else {
          // Try userquery
          const userQueryResponse = await service.sendRequestString(
            accessToken,
            "GET",
            `userqueries?$filter=name eq '${escapedQueryName}' and returnedtypecode eq '${logicalName}'&$select=userqueryid,fetchxml,returnedtypecode`,
            undefined
          );
          const userQueryData = JSON.parse(userQueryResponse);

          if (userQueryData.value && userQueryData.value.length > 0) {
            fetchXml = userQueryData.value[0].fetchxml;
            returnedTypeCode = userQueryData.value[0].returnedtypecode;
          } else {
            throw new Error(
              `Query with name '${queryIdOrName}' not found for table '${logicalName}'`
            );
          }
        }
      }

      // Execute the FetchXML query
      return await this.runCustomQuery(service, fetchXml, returnedTypeCode);
    } catch (error: any) {
      logger.error(`Error running predefined query '${queryIdOrName}':`, error);
      throw error;
    }
  }

  /**
   * Run a custom FetchXML query
   */
  async runCustomQuery(
    service: DataverseWebApiService,
    fetchXml: string,
    tableName?: string
  ): Promise<QueryResult> {
    const accessToken = await service.getAccessTokenFunc()();

    try {
      // Extract table name from FetchXML if not provided
      let entityName = tableName;
      if (!entityName) {
        const entityMatch = fetchXml.match(/<entity\s+name=['"]([^'"]+)['"]/i);
        if (entityMatch) {
          entityName = entityMatch[1];
        } else {
          throw new Error(
            "Could not determine table name from FetchXML. Please provide tableName parameter."
          );
        }
      }

      const logicalName = await this.metadataService.resolveLogicalName(
        service,
        entityName
      );
      const entitySetName = await this.metadataService.getEntitySetName(
        service,
        logicalName
      );

      // Execute FetchXML query
      const encodedFetchXml = encodeURIComponent(fetchXml);
      const response = await service.sendRequestString(
        accessToken,
        "GET",
        `${entitySetName}?fetchXml=${encodedFetchXml}`,
        undefined,
        {
          Prefer:
            'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
        }
      );

      const data = JSON.parse(response);

      if (!data.value || !Array.isArray(data.value)) {
        return {
          tableName: logicalName,
          records: [],
          totalRecordCount: 0,
        };
      }

      // Get the primary ID attribute name from entity metadata
      const metadataResponse = await service.sendRequestString(
        accessToken,
        "GET",
        `EntityDefinitions(LogicalName='${logicalName}')?$select=PrimaryIdAttribute`
      );
      const entityMetadata = JSON.parse(metadataResponse);
      const primaryIdAttribute =
        entityMetadata.PrimaryIdAttribute || `${logicalName}id`;

      const records: QueryRecord[] = data.value.map((record: any) => {
        const recordId = record[primaryIdAttribute] || "";
        return {
          recordId,
          attributes: record,
          deepLink: this.getDeepLinkUrl(
            service.getDataverseUrl(),
            logicalName,
            recordId
          ),
        };
      });

      logger.info(
        `FetchXML query executed successfully. Retrieved ${records.length} records from ${logicalName}`
      );

      return {
        tableName: logicalName,
        records,
        totalRecordCount: records.length,
      };
    } catch (error: any) {
      logger.error("Error executing FetchXML query:", error);

      // Provide detailed error messages for common FetchXML issues
      if (
        error.message?.includes("400") ||
        error.message?.includes("Bad Request")
      ) {
        const errorDetails = this.parseFetchXmlError(error.message);
        throw new Error(
          `Invalid FetchXML query: ${errorDetails}. Please check your FetchXML syntax and ensure all entity and attribute names are correct.`
        );
      }

      throw error;
    }
  }

  /**
   * Parse FetchXML error messages to provide more helpful feedback
   */
  private parseFetchXmlError(errorMessage: string): string {
    if (errorMessage.includes("Invalid FetchXml")) {
      return "The FetchXML syntax is invalid";
    }
    if (
      errorMessage.includes("does not exist") ||
      errorMessage.includes("not found")
    ) {
      return "One or more entity or attribute names in the FetchXML do not exist";
    }
    if (errorMessage.includes("attribute")) {
      return "Invalid attribute name or attribute reference";
    }
    if (errorMessage.includes("entity")) {
      return "Invalid entity name or entity reference";
    }
    return "Please verify the FetchXML structure and all entity/attribute names";
  }
}
