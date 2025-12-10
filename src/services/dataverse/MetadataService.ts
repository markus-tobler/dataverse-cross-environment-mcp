import {
  AttributeDescription,
  AttributeMetadata,
  FieldImportance,
  TableDescription,
  TableMetadata,
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
    tableOrSetName: string
  ): Promise<string> {
    const dataverseUrl = service.getDataverseUrl();
    const cachedEntitySetName = MetadataService.metadataCache.getEntitySetName(
      dataverseUrl,
      tableOrSetName
    );
    if (cachedEntitySetName) {
      return tableOrSetName;
    }
    const allTables =
      MetadataService.metadataCache.getTableMetadata(dataverseUrl);
    if (allTables) {
      const match = allTables.find((t) => t.collectionName === tableOrSetName);
      if (match) {
        return match.logicalName;
      }
    }
    await this.listTables(service);
    const allTables2 =
      MetadataService.metadataCache.getTableMetadata(dataverseUrl);
    if (allTables2) {
      const match = allTables2.find((t) => t.collectionName === tableOrSetName);
      if (match) {
        return match.logicalName;
      }
    }
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
        `EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,Description&$filter=IsValidForAdvancedFind eq true and (${filter})`
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
              collectionName
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

  async describeTable(
    service: DataverseWebApiService,
    tableName: string,
    full: boolean = false
  ): Promise<TableDescription> {
    const dataverseUrl = service.getDataverseUrl();
    const cachedDescription = MetadataService.metadataCache.getTableDescription(
      dataverseUrl,
      tableName,
      full
    );
    if (cachedDescription) {
      return cachedDescription;
    }

    const accessToken = await service.getAccessTokenFunc()();
    const entitySetName = await this.getEntitySetName(service, tableName);
    const metadataResponse = await service.sendRequestString(
      accessToken,
      "GET",
      `EntityDefinitions(LogicalName='${tableName}')?$select=LogicalName,DisplayName,Description,PrimaryIdAttribute,PrimaryNameAttribute&$expand=Attributes`
    );

    const entityMetadata = JSON.parse(metadataResponse);
    const attributes: AttributeMetadata[] = entityMetadata.Attributes || [];
    let importantFields: string[] = [];
    if (!full) {
      importantFields = await this.determineImportantFields(
        entitySetName,
        attributes,
        service,
        accessToken
      );
    }

    const filteredAttributes = full
      ? attributes.filter((attr) => attr.IsValidForRead)
      : attributes.filter(
          (attr) =>
            attr.IsValidForRead &&
            (importantFields.includes(attr.LogicalName) ||
              attr.IsPrimaryId ||
              attr.IsPrimaryName)
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
      tableName,
      description,
      full
    );

    return description;
  }

  private async determineImportantFields(
    entitySetName: string,
    attributes: AttributeMetadata[],
    service: DataverseWebApiService,
    accessToken: string
  ): Promise<string[]> {
    try {
      const modifiedOnAttr = attributes.find(
        (a) => a.LogicalName === "modifiedon"
      );
      const orderBy = modifiedOnAttr ? "$orderby=modifiedon desc" : "";

      const response = await service.sendRequestString(
        accessToken,
        "GET",
        `${entitySetName}?$top=50&${orderBy}`
      );

      const data = JSON.parse(response);
      const records = data.value || [];

      if (records.length === 0) {
        return this.getImportantFieldsFromMetadata(attributes);
      }

      const fieldScores: Map<string, FieldImportance> = new Map();

      for (const attr of attributes) {
        if (
          !attr.IsValidForRead ||
          attr.LogicalName.startsWith("_") ||
          this.isVirtualAnnotationProperty(attr)
        )
          continue;

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
          (r: any) => r[attr.LogicalName] != null && r[attr.LogicalName] !== ""
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
          fieldScores.set(attr.LogicalName, {
            logicalName: attr.LogicalName,
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
    attributes: AttributeMetadata[]
  ): string[] {
    const important = attributes
      .filter(
        (attr) =>
          attr.IsValidForRead &&
          !this.isVirtualAnnotationProperty(attr) &&
          (attr.IsPrimaryId ||
            attr.IsPrimaryName ||
            attr.RequiredLevel?.Value === "ApplicationRequired" ||
            attr.RequiredLevel?.Value === "SystemRequired" ||
            attr.LogicalName.includes("name") ||
            attr.LogicalName.includes("email") ||
            attr.LogicalName === "statecode" ||
            attr.LogicalName === "statuscode")
      )
      .slice(0, 15);

    return important.map((a) => a.LogicalName);
  }

  private isVirtualAnnotationProperty(
    attr: AttributeMetadata,
    primaryNameAttribute?: string
  ): boolean {
    const name = attr.LogicalName;

    if (primaryNameAttribute && name === primaryNameAttribute) {
      return false;
    }

    const annotationSuffixes = ["idname", "idtype", "idyominame"];

    return annotationSuffixes.some((suffix) => name.endsWith(suffix));
  }

  private convertToODataSelectColumns(
    logicalNames: string[],
    allAttributes: AttributeMetadata[]
  ): string[] {
    const result: string[] = [];

    for (const logicalName of logicalNames) {
      const attr = allAttributes.find((a) => a.LogicalName === logicalName);

      if (!attr) {
        result.push(logicalName);
        continue;
      }

      const attributeType = attr.AttributeType || attr.AttributeTypeName?.Value;
      const isLookupType =
        attributeType === "Lookup" ||
        attributeType === "Customer" ||
        attributeType === "Owner" ||
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
    attr: AttributeMetadata
  ): AttributeDescription {
    const displayName =
      attr.DisplayName?.UserLocalizedLabel?.Label || attr.LogicalName;
    const description = attr.Description?.UserLocalizedLabel?.Label;
    const type = attr.AttributeTypeName?.Value || attr.AttributeType;

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
    const type = attr.AttributeTypeName?.Value || attr.AttributeType;

    if (attr.IsPrimaryId) {
      return "00000000-0000-0000-0000-000000000000";
    }

    switch (type) {
      case "StringType":
      case "StringAttributeMetadata":
      case "MemoType":
      case "MemoAttributeMetadata":
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
      case "IntegerAttributeMetadata":
        if (logicalName.includes("count") || logicalName.includes("number"))
          return 42;
        if (logicalName.includes("age")) return 30;
        return 100;

      case "DecimalType":
      case "DecimalAttributeMetadata":
      case "DoubleType":
      case "DoubleAttributeMetadata":
      case "MoneyType":
      case "MoneyAttributeMetadata":
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
      case "BooleanAttributeMetadata":
        return true;

      case "DateTimeType":
      case "DateTimeAttributeMetadata":
        return new Date().toISOString();

      case "PicklistType":
      case "PicklistAttributeMetadata":
      case "StateType":
      case "StateAttributeMetadata":
      case "StatusType":
      case "StatusAttributeMetadata":
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
      case "LookupAttributeMetadata":
      case "CustomerType":
      case "CustomerAttributeMetadata":
      case "OwnerType":
      case "OwnerAttributeMetadata":
        const targetEntity = attr.Targets?.[0] || "entity";
        return {
          id: "00000000-0000-0000-0000-000000000000",
          entityType: targetEntity,
          name: `Sample ${targetEntity}`,
        };

      case "UniqueidentifierType":
      case "UniqueidentifierAttributeMetadata":
        return "00000000-0000-0000-0000-000000000000";

      default:
        return null;
    }
  }

  async getImportantColumnsForTable(
    service: DataverseWebApiService,
    tableName: string
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
          false
        );
        const logicalNames = description.attributes.map(
          (attr) => attr.logicalName
        );
        const accessToken = await service.getAccessTokenFunc()();
        const metadataResponse = await service.sendRequestString(
          accessToken,
          "GET",
          `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName&$expand=Attributes`
        );
        const entityMetadata = JSON.parse(metadataResponse);
        const allAttributes: AttributeMetadata[] =
          entityMetadata.Attributes || [];
        const converted = this.convertToODataSelectColumns(
          logicalNames,
          allAttributes
        );
        return converted;
      }
    );
  }

  async getEntitySetName(
    service: DataverseWebApiService,
    tableName: string
  ): Promise<string> {
    const dataverseUrl = service.getDataverseUrl();
    MetadataService.metadataCache.ensureSystemEntities(dataverseUrl);

    const reverseMatch = MetadataService.metadataCache.getReverseEntitySetName(
      dataverseUrl,
      tableName
    );
    if (reverseMatch) {
      return reverseMatch;
    }

    const cachedEntitySetName = MetadataService.metadataCache.getEntitySetName(
      dataverseUrl,
      tableName
    );
    if (cachedEntitySetName) {
      return cachedEntitySetName;
    }

    await this.listTables(service);

    const reverseEntitySetName =
      MetadataService.metadataCache.getReverseEntitySetName(
        dataverseUrl,
        tableName
      );
    if (reverseEntitySetName) {
      return reverseEntitySetName;
    }

    const entitySetName = MetadataService.metadataCache.getEntitySetName(
      dataverseUrl,
      tableName
    );
    if (entitySetName) {
      return entitySetName;
    }

    throw new Error(`Could not find entity set name for table ${tableName}`);
  }

  private async getReadableEntityNames(
    service: DataverseWebApiService
  ): Promise<Set<string>> {
    const dataverseUrl = service.getDataverseUrl();
    const userId = service.getUserId();
    
    if (!userId) {
      throw new Error("User ID not available. Service may not be initialized.");
    }

    const cached =
      MetadataService.metadataCache.getReadableEntityNames(dataverseUrl, userId);
    if (cached) {
      return cached;
    }

    const accessToken = await service.getAccessTokenFunc()();
    const response = await service.sendRequestString(
      accessToken,
      "GET",
      `systemusers(${userId})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges`
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
      readableEntityNames
    );
    return readableEntityNames;
  }
}
