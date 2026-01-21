import {
  AttributeDescription,
  AttributeMetadata,
  FieldImportance,
  TableDescription,
  TableMetadata,
  TableFormatDescription,
  AttributeFormatDescription,
} from "../../types/dataverse.js";
import { MetadataCacheService } from "../MetadataCacheService.js";
import { DataverseWebApiService } from "./DataverseWebApiService.js";
import { logger } from "../../utils/logger.js";

export class MetadataService {
  private static metadataCache: MetadataCacheService =
    new MetadataCacheService();

  static clearImportantColumnsCache(): void {
    MetadataService.metadataCache.clearImportantColumnsCache();
    MetadataService.metadataCache.clearTableDescriptionsCache();
  }

  async resolveLogicalName(
    service: DataverseWebApiService,
    tableOrSetName: string,
  ): Promise<string> {
    const dataverseUrl = service.getDataverseUrl();

    // Ensure system entities are in cache
    MetadataService.metadataCache.ensureSystemEntities(dataverseUrl);

    // First check if this is an entity set name (plural form) in the reverse cache
    const logicalNameFromSet =
      MetadataService.metadataCache.getReverseEntitySetName(
        dataverseUrl,
        tableOrSetName,
      );
    if (logicalNameFromSet) {
      // tableOrSetName is an entity set name, return the resolved logical name
      return logicalNameFromSet;
    }

    // Check if this is a logical name (singular form) with a known entity set mapping
    const cachedEntitySetName = MetadataService.metadataCache.getEntitySetName(
      dataverseUrl,
      tableOrSetName,
    );
    if (cachedEntitySetName) {
      // tableOrSetName is already a logical name
      return tableOrSetName;
    }

    // Try to find in cached table metadata
    const allTables =
      MetadataService.metadataCache.getTableMetadata(dataverseUrl);
    if (allTables) {
      const match = allTables.find((t) => t.collectionName === tableOrSetName);
      if (match) {
        return match.logicalName;
      }
    }

    // Load all tables and try again
    await this.listTables(service);
    const allTables2 =
      MetadataService.metadataCache.getTableMetadata(dataverseUrl);
    if (allTables2) {
      const match = allTables2.find((t) => t.collectionName === tableOrSetName);
      if (match) {
        return match.logicalName;
      }
    }

    // If still not found, return as-is
    return tableOrSetName;
  }

  async listTables(service: DataverseWebApiService): Promise<TableMetadata[]> {
    const dataverseUrl = service.getDataverseUrl();
    const cachedData =
      MetadataService.metadataCache.getTableMetadata(dataverseUrl);
    if (cachedData) {
      return cachedData;
    }

    const readableEntityNames = await this.getReadableEntityNames(service);
    const tables: TableMetadata[] = [];
    const accessToken = await service.getAccessTokenFunc()();

    const entityNames = Array.from(readableEntityNames);
    const batchSize = 100;

    for (let i = 0; i < entityNames.length; i += batchSize) {
      const batch = entityNames.slice(i, i + batchSize);
      const filter = batch
        .map((name) => `LogicalName eq '${name}'`)
        .join(" or ");
      const response = await service.sendRequestString(
        accessToken,
        "GET",
        `EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,Description&$filter=IsValidForAdvancedFind eq true and (${filter})`,
      );

      const data = JSON.parse(response);

      if (data.value) {
        for (const entity of data.value) {
          const logicalName = entity.LogicalName || "";
          const displayName =
            entity.DisplayName?.UserLocalizedLabel?.Label || logicalName;
          const collectionName = entity.EntitySetName || null;
          const description =
            entity.Description?.UserLocalizedLabel?.Label || null;

          if (logicalName && collectionName) {
            MetadataService.metadataCache.setEntitySetNameBidirectional(
              dataverseUrl,
              logicalName,
              collectionName,
            );
          }

          tables.push({
            logicalName,
            displayName,
            collectionName,
            description,
          });
        }
      }
    }

    tables.sort((a, b) => a.displayName.localeCompare(b.displayName));
    MetadataService.metadataCache.setTableMetadata(dataverseUrl, tables);
    return tables;
  }

  /**
   * Describe a table's schema and attributes
   * @param service - The Dataverse Web API service
   * @param logicalName - The logical name of the table (e.g., 'salesorder', NOT 'salesorders')
   * @param full - If true, return all attributes; otherwise return only important fields
   */
  async describeTable(
    service: DataverseWebApiService,
    logicalName: string,
    full: boolean = false,
  ): Promise<TableDescription> {
    const dataverseUrl = service.getDataverseUrl();
    const cachedDescription = MetadataService.metadataCache.getTableDescription(
      dataverseUrl,
      logicalName,
      full,
    );
    if (cachedDescription) {
      return cachedDescription;
    }

    const accessToken = await service.getAccessTokenFunc()();
    const entitySetName = await this.getEntitySetName(service, logicalName);
    const metadataResponse = await service.sendRequestString(
      accessToken,
      "GET",
      `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,DisplayName,Description,PrimaryIdAttribute,PrimaryNameAttribute&$expand=Attributes`,
    );

    const entityMetadata = JSON.parse(metadataResponse);
    const attributes: AttributeMetadata[] = entityMetadata.Attributes || [];
    let importantFields: string[] = [];
    if (!full) {
      importantFields = await this.determineImportantFields(
        entitySetName,
        attributes,
        service,
        accessToken,
      );
    }

    const filteredAttributes = full
      ? attributes.filter((attr) => attr.IsValidForRead)
      : attributes.filter(
          (attr) =>
            attr.IsValidForRead &&
            (importantFields.includes(attr.LogicalName) ||
              attr.IsPrimaryId ||
              attr.IsPrimaryName),
        );

    const attributeDescriptions: AttributeDescription[] =
      filteredAttributes.map((attr) => this.createAttributeDescription(attr));

    const sampleRecord: Record<string, any> = {};
    for (const attrDesc of attributeDescriptions) {
      sampleRecord[attrDesc.logicalName] = attrDesc.exampleValue;
    }

    const description: TableDescription = {
      logicalName: entityMetadata.LogicalName,
      displayName:
        entityMetadata.DisplayName?.UserLocalizedLabel?.Label ||
        entityMetadata.LogicalName,
      description: entityMetadata.Description?.UserLocalizedLabel?.Label,
      primaryIdAttribute: entityMetadata.PrimaryIdAttribute,
      primaryNameAttribute: entityMetadata.PrimaryNameAttribute,
      attributes: attributeDescriptions,
      sampleRecord,
    };

    MetadataService.metadataCache.setTableDescription(
      dataverseUrl,
      logicalName,
      description,
      full,
    );

    return description;
  }

  private async determineImportantFields(
    entitySetName: string,
    attributes: AttributeMetadata[],
    service: DataverseWebApiService,
    accessToken: string,
  ): Promise<string[]> {
    try {
      const modifiedOnAttr = attributes.find(
        (a) => a.LogicalName === "modifiedon",
      );
      const orderBy = modifiedOnAttr ? "$orderby=modifiedon desc" : "";

      const response = await service.sendRequestString(
        accessToken,
        "GET",
        `${entitySetName}?$top=50&${orderBy}`,
      );

      const data = JSON.parse(response);
      const records = data.value || [];

      if (records.length === 0) {
        return this.getImportantFieldsFromMetadata(attributes);
      }

      // Debug: Log attributes that appear in records but might be computed
      logger.debug(
        `Found ${records.length} records for sampling. First record has ${Object.keys(records[0] || {}).length} properties`,
      );

      // Build a map of valid selectable attributes from metadata
      // These are the ONLY attributes we'll consider for scoring
      const selectableAttributes = new Map<string, AttributeMetadata>();
      for (const attr of attributes) {
        // Skip attributes that are not readable or internal/virtual
        if (!attr.IsValidForRead || attr.LogicalName.startsWith("_")) {
          continue;
        }

        // Skip virtual annotation properties
        if (this.isVirtualAnnotationProperty(attr, entitySetName)) {
          continue;
        }

        // Skip computed/logical attributes identified by metadata properties
        const hasAttributeOf =
          attr.AttributeOf !== undefined && attr.AttributeOf !== null;
        const isLogical = attr.IsLogical === true;

        // Skip read-only computed attributes (can't create or update)
        // These are typically computed values like rollups, calculated fields, etc.
        const isReadOnlyComputed =
          attr.IsValidForCreate === false && attr.IsValidForUpdate === false;

        if (hasAttributeOf || isLogical || isReadOnlyComputed) {
          logger.debug(
            `Excluding computed/logical/read-only attribute: ${attr.LogicalName} (AttributeOf=${attr.AttributeOf}, IsLogical=${attr.IsLogical}, Create=${attr.IsValidForCreate}, Update=${attr.IsValidForUpdate})`,
          );
          continue;
        }

        selectableAttributes.set(attr.LogicalName, attr);
      }

      logger.debug(
        `Metadata contains ${attributes.length} attributes, ${selectableAttributes.size} are selectable`,
      );

      // Check for fields in records that aren't in selectable metadata (these are computed)
      if (records.length > 0) {
        const firstRecord = records[0];
        const recordKeys = Object.keys(firstRecord).filter(
          (key) =>
            !key.startsWith("@") &&
            !key.startsWith("_") &&
            !key.endsWith("@OData.Community.Display.V1.FormattedValue"),
        );

        const computedFields = recordKeys.filter(
          (key) => !selectableAttributes.has(key),
        );

        if (computedFields.length > 0) {
          logger.debug(
            `Found ${computedFields.length} computed fields in records (not in selectable metadata): ${computedFields.join(", ")}`,
          );
        }
      }

      const fieldScores: Map<string, FieldImportance> = new Map();

      // Only score attributes that are in our selectable set
      for (const [logicalName, attr] of selectableAttributes) {
        let score = 0;
        const reasons: string[] = [];

        if (attr.IsPrimaryId) {
          score += 1000;
          reasons.push("primary ID");
        }
        if (attr.IsPrimaryName) {
          score += 900;
          reasons.push("primary name");
        }

        if (
          attr.RequiredLevel?.Value === "ApplicationRequired" ||
          attr.RequiredLevel?.Value === "SystemRequired"
        ) {
          score += 100;
          reasons.push("required");
        }

        const nonNullCount = records.filter(
          (r: any) => r[attr.LogicalName] != null && r[attr.LogicalName] !== "",
        ).length;
        const fillRate = nonNullCount / records.length;

        if (fillRate > 0.5) {
          score += fillRate * 50;
          reasons.push(`${Math.round(fillRate * 100)}% populated`);
        }

        const importantNames = [
          "name",
          "title",
          "subject",
          "email",
          "phone",
          "status",
          "state",
        ];
        if (importantNames.some((n) => attr.LogicalName.includes(n))) {
          score += 30;
          reasons.push("common field");
        }

        if (score > 0) {
          fieldScores.set(logicalName, {
            logicalName: logicalName,
            score,
            reason: reasons.join(", "),
          });
        }
      }

      const sortedFields = Array.from(fieldScores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);

      return sortedFields.map((f) => f.logicalName);
    } catch (error) {
      logger.warn("Error sampling records, falling back to metadata:", error);
      return this.getImportantFieldsFromMetadata(attributes);
    }
  }

  private getImportantFieldsFromMetadata(
    attributes: AttributeMetadata[],
  ): string[] {
    const important = attributes
      .filter((attr) => {
        const hasAttributeOf =
          attr.AttributeOf !== undefined && attr.AttributeOf !== null;
        const isLogical = attr.IsLogical === true;
        const isReadOnlyComputed =
          attr.IsValidForCreate === false && attr.IsValidForUpdate === false;

        return (
          attr.IsValidForRead &&
          !this.isVirtualAnnotationProperty(attr) &&
          !hasAttributeOf &&
          !isLogical &&
          !isReadOnlyComputed &&
          (attr.IsPrimaryId ||
            attr.IsPrimaryName ||
            attr.RequiredLevel?.Value === "ApplicationRequired" ||
            attr.RequiredLevel?.Value === "SystemRequired" ||
            attr.LogicalName.includes("name") ||
            attr.LogicalName.includes("email") ||
            attr.LogicalName === "statecode" ||
            attr.LogicalName === "statuscode")
        );
      })
      .slice(0, 15);

    return important.map((a) => a.LogicalName);
  }

  private isVirtualAnnotationProperty(
    attr: AttributeMetadata,
    primaryNameAttribute?: string,
  ): boolean {
    const name = attr.LogicalName;

    if (primaryNameAttribute && name === primaryNameAttribute) {
      return false;
    }

    // Virtual annotation properties are OData formatted value properties
    // These are read-only and generated by Dataverse, not actual stored fields
    const annotationSuffixes = [
      "idname",
      "idtype",
      "idyominame",
      "name", // Formatted lookup values (e.g., _ownerid_value@OData.Community.Display.V1.FormattedValue)
      "typecodename", // Option set formatted values
      "addresstypecodename", // Specific to address entities
    ];

    return annotationSuffixes.some((suffix) => name.endsWith(suffix));
  }

  private convertToODataSelectColumns(
    logicalNames: string[],
    allAttributes: AttributeMetadata[],
  ): string[] {
    const result: string[] = [];

    for (const logicalName of logicalNames) {
      const attr = allAttributes.find((a) => a.LogicalName === logicalName);

      if (!attr) {
        result.push(logicalName);
        continue;
      }

      // Use AttributeTypeName.Value (recommended) instead of AttributeType (older property)
      // Reference: https://learn.microsoft.com/en-us/dotnet/api/microsoft.xrm.sdk.metadata.attributemetadata.attributetypename
      const attributeType = attr.AttributeTypeName?.Value;
      const isLookupType =
        attributeType === "LookupType" ||
        attributeType === "CustomerType" ||
        attributeType === "OwnerType";

      if (isLookupType) {
        const lookupProperty = `_${logicalName}_value`;
        result.push(lookupProperty);
      } else {
        result.push(logicalName);
      }
    }

    return result;
  }

  private createAttributeDescription(
    attr: AttributeMetadata,
  ): AttributeDescription {
    const displayName =
      attr.DisplayName?.UserLocalizedLabel?.Label || attr.LogicalName;
    const description = attr.Description?.UserLocalizedLabel?.Label;
    const type = attr.AttributeTypeName?.Value || "Unknown";

    const exampleValue = this.generateSyntheticValue(attr);

    return {
      logicalName: attr.LogicalName,
      displayName,
      description,
      type,
      isPrimaryId: attr.IsPrimaryId || false,
      isPrimaryName: attr.IsPrimaryName || false,
      isRequired:
        attr.RequiredLevel?.Value === "ApplicationRequired" ||
        attr.RequiredLevel?.Value === "SystemRequired" ||
        false,
      isReadOnly: (!attr.IsValidForCreate && !attr.IsValidForUpdate) || false,
      maxLength: attr.MaxLength,
      format: attr.Format,
      exampleValue,
    };
  }

  private generateSyntheticValue(attr: AttributeMetadata): any {
    const logicalName = attr.LogicalName.toLowerCase();
    const type = attr.AttributeTypeName?.Value;

    if (attr.IsPrimaryId) {
      return "00000000-0000-0000-0000-000000000000";
    }

    switch (type) {
      case "StringType":
      case "MemoType":
        if (logicalName.includes("email")) return "user@example.com";
        if (logicalName.includes("phone") || logicalName.includes("telephone"))
          return "+1-555-0100";
        if (logicalName.includes("url") || logicalName.includes("website"))
          return "https://example.com";
        if (logicalName.includes("name")) return "Sample Name";
        if (
          logicalName.includes("description") ||
          logicalName.includes("notes")
        )
          return "Sample description text";
        if (logicalName.includes("address")) return "123 Main Street";
        if (logicalName.includes("city")) return "Seattle";
        if (logicalName.includes("zip") || logicalName.includes("postal"))
          return "98101";
        if (logicalName.includes("country")) return "USA";
        return "Sample text";

      case "IntegerType":
        if (logicalName.includes("count") || logicalName.includes("number"))
          return 42;
        if (logicalName.includes("age")) return 30;
        return 100;

      case "DecimalType":
      case "DoubleType":
      case "MoneyType":
        if (
          logicalName.includes("price") ||
          logicalName.includes("amount") ||
          logicalName.includes("revenue")
        ) {
          return 1234.56;
        }
        if (logicalName.includes("percent") || logicalName.includes("rate"))
          return 0.15;
        return 99.99;

      case "BooleanType":
        return true;

      case "DateTimeType":
        return new Date().toISOString();

      case "PicklistType":
      case "StateType":
      case "StatusType":
        if (attr.OptionSet?.Options && attr.OptionSet.Options.length > 0) {
          const firstOption = attr.OptionSet.Options[0];
          return {
            value: firstOption.Value,
            label:
              firstOption.Label?.UserLocalizedLabel?.Label ||
              `Option ${firstOption.Value}`,
          };
        }
        return { value: 1, label: "Sample Option" };

      case "LookupType":
      case "CustomerType":
      case "OwnerType":
        const targetEntity = attr.Targets?.[0] || "entity";
        return {
          id: "00000000-0000-0000-0000-000000000000",
          entityType: targetEntity,
          name: `Sample ${targetEntity}`,
        };

      case "UniqueidentifierType":
        return "00000000-0000-0000-0000-000000000000";

      default:
        return null;
    }
  }

  async getImportantColumnsForTable(
    service: DataverseWebApiService,
    tableName: string,
  ): Promise<string[]> {
    const logicalName = await this.resolveLogicalName(service, tableName);
    const dataverseUrl = service.getDataverseUrl();
    const userId = service.getUserId();

    return await MetadataService.metadataCache.getImportantColumnsAsync(
      dataverseUrl,
      logicalName,
      userId,
      async () => {
        const description = await this.describeTable(
          service,
          logicalName,
          false,
        );
        const logicalNames = description.attributes.map(
          (attr) => attr.logicalName,
        );
        const accessToken = await service.getAccessTokenFunc()();
        const metadataResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName&$expand=Attributes`,
        );
        const entityMetadata = JSON.parse(metadataResponse);
        const allAttributes: AttributeMetadata[] =
          entityMetadata.Attributes || [];
        const converted = this.convertToODataSelectColumns(
          logicalNames,
          allAttributes,
        );
        return converted;
      },
    );
  }

  async getEntitySetName(
    service: DataverseWebApiService,
    tableName: string,
  ): Promise<string> {
    const dataverseUrl = service.getDataverseUrl();
    MetadataService.metadataCache.ensureSystemEntities(dataverseUrl);

    const reverseMatch = MetadataService.metadataCache.getReverseEntitySetName(
      dataverseUrl,
      tableName,
    );
    if (reverseMatch) {
      return reverseMatch;
    }

    const cachedEntitySetName = MetadataService.metadataCache.getEntitySetName(
      dataverseUrl,
      tableName,
    );
    if (cachedEntitySetName) {
      return cachedEntitySetName;
    }

    await this.listTables(service);

    const reverseEntitySetName =
      MetadataService.metadataCache.getReverseEntitySetName(
        dataverseUrl,
        tableName,
      );
    if (reverseEntitySetName) {
      return reverseEntitySetName;
    }

    const entitySetName = MetadataService.metadataCache.getEntitySetName(
      dataverseUrl,
      tableName,
    );
    if (entitySetName) {
      return entitySetName;
    }

    // If still not found, query the entity directly by LogicalName
    // This handles entities that may not be in the readable list
    try {
      const accessToken = await service.getAccessTokenFunc()();
      const response = await service.sendRequestString(
        accessToken,
        "GET",
        `EntityDefinitions(LogicalName='${tableName}')?$select=LogicalName,EntitySetName`,
      );
      const entityData = JSON.parse(response);

      if (entityData.EntitySetName) {
        // Cache the mapping for future use
        MetadataService.metadataCache.setEntitySetNameBidirectional(
          dataverseUrl,
          tableName,
          entityData.EntitySetName,
        );
        return entityData.EntitySetName;
      }
    } catch (error: any) {
      // If entity doesn't exist or can't be accessed, fall through to error
      logger.debug(
        `Could not retrieve EntitySetName for ${tableName}: ${error.message}`,
      );
    }

    throw new Error(`Could not find entity set name for table ${tableName}`);
  }

  private async getReadableEntityNames(
    service: DataverseWebApiService,
  ): Promise<Set<string>> {
    const dataverseUrl = service.getDataverseUrl();
    const userId = service.getUserId();

    if (!userId) {
      throw new Error("User ID not available. Service may not be initialized.");
    }

    const cached = MetadataService.metadataCache.getReadableEntityNames(
      dataverseUrl,
      userId,
    );
    if (cached) {
      return cached;
    }

    const accessToken = await service.getAccessTokenFunc()();
    const response = await service.sendRequestString(
      accessToken,
      "GET",
      `systemusers(${userId})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges`,
    );

    const data = JSON.parse(response);
    const readableEntityNames = new Set<string>();

    if (data.RolePrivileges) {
      for (const privilege of data.RolePrivileges) {
        const privilegeName = privilege.PrivilegeName as string;
        if (privilegeName.startsWith("prvRead")) {
          const entityName = privilegeName.substring(7).toLocaleLowerCase();
          readableEntityNames.add(entityName);
        }
      }
    }

    MetadataService.metadataCache.setReadableEntityNames(
      dataverseUrl,
      userId,
      readableEntityNames,
    );
    return readableEntityNames;
  }

  /**
   * Describe table format with detailed metadata for creating valid records.
   * This provides comprehensive information about field types, option sets, lookups, etc.
   * to help LLM agents create valid records.
   */
  /**
   * Get comprehensive format information for creating valid records in a table
   * @param service - The Dataverse Web API service
   * @param logicalName - The logical name of the table (e.g., 'salesorder', NOT 'salesorders')
   */
  async describeTableFormat(
    service: DataverseWebApiService,
    logicalName: string,
  ): Promise<TableFormatDescription> {
    const dataverseUrl = service.getDataverseUrl();

    // Check cache first
    const cachedDescription =
      MetadataService.metadataCache.getTableFormatDescription(
        dataverseUrl,
        logicalName,
      );
    if (cachedDescription) {
      return cachedDescription;
    }

    const accessToken = await service.getAccessTokenFunc()();

    // Get basic entity metadata with all attributes
    const metadataResponse = await service.sendRequestString(
      accessToken,
      "GET",
      `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,DisplayName,Description,PrimaryIdAttribute,PrimaryNameAttribute&$expand=Attributes`,
    );

    const entityMetadata = JSON.parse(metadataResponse);
    const attributes: AttributeMetadata[] = entityMetadata.Attributes || [];

    // For picklist and multi-select picklist attributes, we need to fetch OptionSet details separately
    // because the basic Attributes expansion doesn't include full OptionSet metadata
    const regularPicklistAttributes = attributes.filter(
      (attr) => attr.AttributeTypeName?.Value === "PicklistType",
    );

    const stateAttributes = attributes.filter(
      (attr) => attr.AttributeTypeName?.Value === "StateType",
    );

    const statusAttributes = attributes.filter(
      (attr) => attr.AttributeTypeName?.Value === "StatusType",
    );

    const multiSelectPicklistAttributes = attributes.filter(
      (attr) => attr.AttributeTypeName?.Value === "MultiSelectPicklistType",
    );

    // Fetch full metadata for regular picklist attributes including OptionSet
    for (const picklistAttr of regularPicklistAttributes) {
      try {
        const picklistResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `EntityDefinitions(LogicalName='${logicalName}')/Attributes(LogicalName='${picklistAttr.LogicalName}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet,GlobalOptionSet`,
        );
        const picklistData = JSON.parse(picklistResponse);

        // Merge the OptionSet data into the attribute
        const attrIndex = attributes.findIndex(
          (a) => a.LogicalName === picklistAttr.LogicalName,
        );
        if (attrIndex !== -1) {
          attributes[attrIndex].OptionSet =
            picklistData.OptionSet || picklistData.GlobalOptionSet;
        }
      } catch (error) {
        logger.warn(
          `Could not fetch OptionSet metadata for ${picklistAttr.LogicalName}:`,
          error,
        );
      }
    }

    // Fetch full metadata for state attributes
    for (const stateAttr of stateAttributes) {
      try {
        const stateResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `EntityDefinitions(LogicalName='${logicalName}')/Attributes(LogicalName='${stateAttr.LogicalName}')/Microsoft.Dynamics.CRM.StateAttributeMetadata?$select=LogicalName&$expand=OptionSet`,
        );
        const stateData = JSON.parse(stateResponse);

        const attrIndex = attributes.findIndex(
          (a) => a.LogicalName === stateAttr.LogicalName,
        );
        if (attrIndex !== -1) {
          attributes[attrIndex].OptionSet = stateData.OptionSet;
        }
      } catch (error) {
        logger.warn(
          `Could not fetch OptionSet metadata for ${stateAttr.LogicalName}:`,
          error,
        );
      }
    }

    // Fetch full metadata for status attributes
    for (const statusAttr of statusAttributes) {
      try {
        const statusResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `EntityDefinitions(LogicalName='${logicalName}')/Attributes(LogicalName='${statusAttr.LogicalName}')/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$select=LogicalName&$expand=OptionSet`,
        );
        const statusData = JSON.parse(statusResponse);

        const attrIndex = attributes.findIndex(
          (a) => a.LogicalName === statusAttr.LogicalName,
        );
        if (attrIndex !== -1) {
          attributes[attrIndex].OptionSet = statusData.OptionSet;
        }
      } catch (error) {
        logger.warn(
          `Could not fetch OptionSet metadata for ${statusAttr.LogicalName}:`,
          error,
        );
      }
    }

    // Fetch full metadata for multi-select picklist attributes including OptionSet
    for (const multiSelectAttr of multiSelectPicklistAttributes) {
      try {
        const multiSelectResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `EntityDefinitions(LogicalName='${logicalName}')/Attributes(LogicalName='${multiSelectAttr.LogicalName}')/Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet,GlobalOptionSet`,
        );
        const multiSelectData = JSON.parse(multiSelectResponse);

        // Merge the OptionSet data into the attribute
        const attrIndex = attributes.findIndex(
          (a) => a.LogicalName === multiSelectAttr.LogicalName,
        );
        if (attrIndex !== -1) {
          attributes[attrIndex].OptionSet =
            multiSelectData.OptionSet || multiSelectData.GlobalOptionSet;
        }
      } catch (error) {
        logger.warn(
          `Could not fetch OptionSet metadata for ${multiSelectAttr.LogicalName}:`,
          error,
        );
      }
    }

    // Fetch full metadata for boolean attributes to get their option labels
    const booleanAttributes = attributes.filter(
      (attr) => attr.AttributeTypeName?.Value === "BooleanType",
    );

    for (const boolAttr of booleanAttributes) {
      try {
        const boolResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `EntityDefinitions(LogicalName='${logicalName}')/Attributes(LogicalName='${boolAttr.LogicalName}')/Microsoft.Dynamics.CRM.BooleanAttributeMetadata?$select=LogicalName&$expand=OptionSet`,
        );
        const boolData = JSON.parse(boolResponse);

        const attrIndex = attributes.findIndex(
          (a) => a.LogicalName === boolAttr.LogicalName,
        );
        if (attrIndex !== -1) {
          attributes[attrIndex].OptionSet = boolData.OptionSet;
        }
      } catch (error) {
        logger.warn(
          `Could not fetch OptionSet metadata for boolean ${boolAttr.LogicalName}:`,
          error,
        );
      }
    }

    // Filter to attributes that can be created or updated
    const creatableAttributes = attributes.filter(
      (attr) => attr.IsValidForCreate || attr.IsValidForUpdate,
    );

    // Create detailed attribute descriptions
    const attributeFormatDescriptions: AttributeFormatDescription[] = [];

    for (const attr of creatableAttributes) {
      const formatDesc = await this.createAttributeFormatDescription(
        attr,
        service,
        accessToken,
      );
      attributeFormatDescriptions.push(formatDesc);
    }

    // Get required attributes (excluding primary ID which is auto-generated)
    const requiredAttributes = attributeFormatDescriptions
      .filter((attr) => attr.isRequired && !attr.isPrimaryId)
      .map((attr) => attr.logicalName);

    // Create general guidance for the table
    const creationGuidance = this.generateCreationGuidance(
      entityMetadata.LogicalName,
      entityMetadata.DisplayName?.UserLocalizedLabel?.Label ||
        entityMetadata.LogicalName,
      requiredAttributes,
      attributeFormatDescriptions,
    );

    const formatDescription: TableFormatDescription = {
      logicalName: entityMetadata.LogicalName,
      displayName:
        entityMetadata.DisplayName?.UserLocalizedLabel?.Label ||
        entityMetadata.LogicalName,
      description: entityMetadata.Description?.UserLocalizedLabel?.Label,
      primaryIdAttribute: entityMetadata.PrimaryIdAttribute,
      primaryNameAttribute: entityMetadata.PrimaryNameAttribute,
      attributes: attributeFormatDescriptions,
      requiredAttributes,
      creationGuidance,
    };

    // Cache the result
    MetadataService.metadataCache.setTableFormatDescription(
      dataverseUrl,
      logicalName,
      formatDescription,
    );

    return formatDescription;
  }

  /**
   * Create detailed attribute format description with guidance for LLM agents
   */
  private async createAttributeFormatDescription(
    attr: AttributeMetadata,
    service: DataverseWebApiService,
    accessToken: string,
  ): Promise<AttributeFormatDescription> {
    const displayName =
      attr.DisplayName?.UserLocalizedLabel?.Label || attr.LogicalName;
    const description = attr.Description?.UserLocalizedLabel?.Label;
    const type = attr.AttributeTypeName?.Value || "Unknown";

    // Build format guidance and example values based on type
    let formatGuidance = "";
    const exampleValues: string[] = [];
    let optionSet: AttributeFormatDescription["optionSet"];
    let booleanOptions: AttributeFormatDescription["booleanOptions"];
    let lookupTargets: AttributeFormatDescription["lookupTargets"];

    switch (type) {
      case "StringType":
        formatGuidance = `String value${
          attr.MaxLength
            ? ` with maximum length of ${attr.MaxLength} characters`
            : ""
        }. ${attr.Format ? `Format: ${attr.Format}.` : ""}`;
        exampleValues.push('"Sample text"');
        if (attr.LogicalName.includes("email")) {
          exampleValues.push('"user@example.com"');
        }
        if (attr.LogicalName.includes("phone")) {
          exampleValues.push('"+1-555-0100"');
        }
        break;

      case "MemoType":
        formatGuidance = `Multi-line text${
          attr.MaxLength
            ? ` with maximum length of ${attr.MaxLength} characters`
            : ""
        }.`;
        exampleValues.push(
          '"This is a longer text that can span multiple lines..."',
        );
        break;

      case "IntegerType":
        formatGuidance = `Integer value${
          attr.MinValue !== undefined || attr.MaxValue !== undefined
            ? ` between ${attr.MinValue ?? "no minimum"} and ${
                attr.MaxValue ?? "no maximum"
              }`
            : ""
        }.`;
        exampleValues.push("42", "100");
        break;

      case "DecimalType":
      case "DoubleType":
        formatGuidance = `Decimal number${
          attr.Precision
            ? ` with precision of ${attr.Precision} decimal places`
            : ""
        }${
          attr.MinValue !== undefined || attr.MaxValue !== undefined
            ? ` between ${attr.MinValue ?? "no minimum"} and ${
                attr.MaxValue ?? "no maximum"
              }`
            : ""
        }.`;
        exampleValues.push("123.45", "99.99");
        break;

      case "MoneyType":
        formatGuidance = `Money value${
          attr.Precision
            ? ` with precision of ${attr.Precision} decimal places`
            : ""
        }${
          attr.MinValue !== undefined || attr.MaxValue !== undefined
            ? ` between ${attr.MinValue ?? "no minimum"} and ${
                attr.MaxValue ?? "no maximum"
              }`
            : ""
        }.`;
        exampleValues.push("1234.56", "99.99");
        break;

      case "BooleanType":
        // Get boolean option labels
        if (attr.OptionSet?.Options) {
          const trueOpt = attr.OptionSet.Options.find((o) => o.Value === 1);
          const falseOpt = attr.OptionSet.Options.find((o) => o.Value === 0);

          booleanOptions = {
            trueOption: {
              value: 1,
              label: trueOpt?.Label?.UserLocalizedLabel?.Label || "Yes",
            },
            falseOption: {
              value: 0,
              label: falseOpt?.Label?.UserLocalizedLabel?.Label || "No",
            },
          };

          formatGuidance = `Boolean value. Accepted values: true, false, 1, 0, "${booleanOptions.trueOption.label}", or "${booleanOptions.falseOption.label}".`;
          exampleValues.push("true", "false", "1", "0");
        } else {
          formatGuidance =
            "Boolean value. Accepted values: true, false, 1, or 0.";
          exampleValues.push("true", "false");
        }
        break;

      case "DateTimeType":
        formatGuidance = `Date and time in ISO 8601 format. ${
          attr.Format === "DateOnly" ? "Only the date portion is used." : ""
        }`;
        exampleValues.push(
          `"${new Date().toISOString()}"`,
          '"2024-12-13T10:30:00Z"',
        );
        break;

      case "PicklistType":
      case "StateType":
      case "StatusType":
        // Get option set details
        if (attr.OptionSet?.Options) {
          const options = attr.OptionSet.Options.map((opt) => ({
            value: opt.Value,
            label:
              opt.Label?.UserLocalizedLabel?.Label || `Option ${opt.Value}`,
            description: undefined,
          }));

          optionSet = {
            name: attr.OptionSet.Name || attr.LogicalName,
            isGlobal: attr.OptionSet.IsGlobal || false,
            options,
          };

          formatGuidance = `Choice field (option set). Accepted values: integer value (${options
            .map((o) => o.value)
            .join(", ")}) or label name (${options
            .map((o) => `"${o.label}"`)
            .join(", ")}). Use integer values for best reliability.`;
          exampleValues.push(
            options[0].value.toString(),
            `"${options[0].label}"`,
          );
        } else {
          formatGuidance =
            "Choice field (option set). Use describe_table to see available options.";
          exampleValues.push("1");
        }
        break;

      case "MultiSelectPicklistType":
        // Get multi-select option set details
        if (attr.OptionSet?.Options) {
          const options = attr.OptionSet.Options.map((opt) => ({
            value: opt.Value,
            label:
              opt.Label?.UserLocalizedLabel?.Label || `Option ${opt.Value}`,
            description: undefined,
          }));

          optionSet = {
            name: attr.OptionSet.Name || attr.LogicalName,
            isGlobal: attr.OptionSet.IsGlobal || false,
            options,
          };

          formatGuidance = `Multi-select choice field. Accepted values: comma-separated integer values (e.g., "1,2,3") or label names (e.g., "Option1,Option2"). Available options: ${options
            .map((o) => `${o.value}="${o.label}"`)
            .join(", ")}. Use integer values for best reliability.`;
          exampleValues.push(
            `"${options[0].value},${options[1]?.value || options[0].value}"`,
            `"${options[0].label}"`,
          );
        } else {
          formatGuidance =
            "Multi-select choice field. Use describe_table to see available options.";
          exampleValues.push('"1,2"');
        }
        break;

      case "LookupType":
      case "CustomerType":
      case "OwnerType":
        // Get lookup target information
        if (attr.Targets && attr.Targets.length > 0) {
          lookupTargets = [];

          for (const targetEntity of attr.Targets) {
            try {
              // Get metadata for the target entity
              const targetMetadata = await service.sendRequestString(
                accessToken,
                "GET",
                `EntityDefinitions(LogicalName='${targetEntity}')?$select=LogicalName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute`,
              );
              const targetData = JSON.parse(targetMetadata);

              lookupTargets.push({
                entityLogicalName: targetData.LogicalName,
                entityDisplayName:
                  targetData.DisplayName?.UserLocalizedLabel?.Label ||
                  targetData.LogicalName,
                primaryIdAttribute: targetData.PrimaryIdAttribute,
                primaryNameAttribute: targetData.PrimaryNameAttribute || "",
              });
            } catch (error) {
              logger.warn(
                `Could not fetch metadata for lookup target ${targetEntity}:`,
                error,
              );
            }
          }

          const targetNames = lookupTargets
            .map((t) => t.entityDisplayName)
            .join(", ");
          const isPolymorphic = attr.Targets.length > 1;

          // Determine the type suffix for polymorphic lookups
          let typeSuffix = "";
          if (attr.LogicalName === "ownerid") {
            typeSuffix = "owneridtype";
          } else if (attr.LogicalName === "regardingobjectid") {
            typeSuffix = "regardingobjecttypecode";
          } else if (attr.LogicalName.endsWith("id")) {
            typeSuffix = attr.LogicalName.replace(/id$/, "type");
          }

          formatGuidance =
            `Lookup field referencing ${targetNames}. ` +
            `Accepted formats:\n` +
            `  - GUID only: "12345678-1234-1234-1234-123456789abc"${
              isPolymorphic ? " (requires entity type)" : ""
            }\n` +
            `  - Web API style: "${attr.Targets[0]}s(12345678-1234-1234-1234-123456789abc)"\n` +
            `  - Entity/GUID pair: "${attr.Targets[0]}=12345678-1234-1234-1234-123456789abc"\n` +
            `  - Primary name: "Record Name" (must be unique in the target table)` +
            (isPolymorphic && typeSuffix
              ? `\n  - Separate fields: { "${attr.LogicalName}": "guid", "${typeSuffix}": "${attr.Targets[0]}" }`
              : "");

          exampleValues.push(
            `"${attr.Targets[0]}s(00000000-0000-0000-0000-000000000000)"`,
            `"${attr.Targets[0]}=00000000-0000-0000-0000-000000000000"`,
            '"Sample Record Name"',
          );
        } else {
          formatGuidance =
            "Lookup field. Provide GUID, Web API reference, or unique record name.";
          exampleValues.push('"00000000-0000-0000-0000-000000000000"');
        }
        break;

      case "UniqueidentifierType":
        formatGuidance =
          "Unique identifier (GUID) in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.";
        exampleValues.push('"12345678-1234-1234-1234-123456789abc"');
        break;

      case "ImageType":
        formatGuidance = "Image data as base64-encoded string.";
        exampleValues.push('"data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."');
        break;

      case "FileType":
      case "FileAttributeMetadata":
        formatGuidance = "File data as base64-encoded string with filename.";
        exampleValues.push('"base64-encoded-file-data"');
        break;

      default:
        formatGuidance = `Field of type ${type}. Check Dataverse documentation for specific format requirements.`;
        exampleValues.push("null");
    }

    return {
      logicalName: attr.LogicalName,
      displayName,
      description,
      type,
      isPrimaryId: attr.IsPrimaryId || false,
      isPrimaryName: attr.IsPrimaryName || false,
      isRequired:
        attr.RequiredLevel?.Value === "ApplicationRequired" ||
        attr.RequiredLevel?.Value === "SystemRequired" ||
        false,
      isReadOnly: !attr.IsValidForCreate && !attr.IsValidForUpdate,
      isValidForCreate: attr.IsValidForCreate || false,
      isValidForUpdate: attr.IsValidForUpdate || false,
      maxLength: attr.MaxLength,
      minValue: attr.MinValue,
      maxValue: attr.MaxValue,
      precision: attr.Precision,
      format: attr.Format,
      optionSet,
      booleanOptions,
      lookupTargets,
      formatGuidance,
      exampleValues,
    };
  }

  /**
   * Generate general guidance for creating records in a table
   */
  private generateCreationGuidance(
    logicalName: string,
    displayName: string,
    requiredAttributes: string[],
    attributes: AttributeFormatDescription[],
  ): string {
    const requiredFieldsList =
      requiredAttributes.length > 0
        ? requiredAttributes.map((attr) => `"${attr}"`).join(", ")
        : "none";

    const lookupFields = attributes.filter((a) => a.lookupTargets);
    const optionSetFields = attributes.filter((a) => a.optionSet);
    const booleanFields = attributes.filter((a) => a.booleanOptions);

    let guidance = `Creating records in the ${displayName} (${logicalName}) table:\n\n`;
    guidance += `Required fields: ${requiredFieldsList}\n\n`;

    if (lookupFields.length > 0) {
      guidance += `Lookup Fields (${lookupFields.length}):\n`;
      guidance += `Lookup fields reference other records. You can specify them using:\n`;
      guidance += `  - GUID: "12345678-1234-1234-1234-123456789abc"\n`;
      guidance += `  - Web API style: "tablename(guid)"\n`;
      guidance += `  - Entity/GUID pair: "entityname=guid"\n`;
      guidance += `  - Primary name: "Unique Record Name"\n`;
      guidance += `\nFor polymorphic lookups (like ownerid, regardingobjectid), you can also use:\n`;
      guidance += `  - Separate ID and type fields: { "ownerid": "guid", "owneridtype": "systemuser" }\n\n`;
    }

    if (optionSetFields.length > 0) {
      guidance += `Choice/Option Set Fields (${optionSetFields.length}):\n`;
      guidance += `Option set fields have predefined values. Use integer values for best reliability.\n`;
      guidance += `You can also use label names, but they must match exactly.\n\n`;
    }

    if (booleanFields.length > 0) {
      guidance += `Boolean Fields (${booleanFields.length}):\n`;
      guidance += `Boolean fields accept: true, false, 1, 0, or their label names.\n\n`;
    }

    guidance += `General tips:\n`;
    guidance += `  - All date/time values should be in ISO 8601 format\n`;
    guidance += `  - Respect max length constraints for text fields\n`;
    guidance += `  - Read-only fields cannot be set during create or update\n`;
    guidance += `  - Use the exact logical names for fields as shown in the attributes list\n`;

    return guidance;
  }
}
