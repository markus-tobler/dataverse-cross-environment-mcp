import {
  AttributeDescription,
  TableDescription,
} from "../../types/dataverse.js";
import { DataverseWebApiService } from "./DataverseWebApiService.js";
import { MetadataService } from "./MetadataService.js";
import { logger } from "../../utils/logger.js";
import { isGuid, escapeODataValue } from "../../utils/guidUtils.js";

/**
 * Service for mutating data in Dataverse
 * Handles create, update operations and payload processing
 */
export class DataMutationService {
  private metadataService: MetadataService;

  constructor(metadataService: MetadataService) {
    this.metadataService = metadataService;
  }

  async createRecord(
    service: DataverseWebApiService,
    tableName: string,
    data: Record<string, any>
  ): Promise<string> {
    logger.debug(
      `CreateRecord called for table '${tableName}' with data:`,
      JSON.stringify(data, null, 2)
    );
    logger.debug(`Data keys provided: ${Object.keys(data).join(", ")}`);

    // Validate that all required attributes are provided
    await this.validateRequiredAttributes(service, tableName, data);

    const entitySetName = await this.metadataService.getEntitySetName(
      service,
      tableName
    );
    const processedData = await this.processPayload(service, tableName, data);
    logger.debug(
      `Processed payload for table '${tableName}':`,
      JSON.stringify(processedData, null, 2)
    );
    const response = await service.createRecord(entitySetName, processedData);

    if (response.ok) {
      const odataEntityId = response.headers.get("OData-EntityId");
      if (odataEntityId) {
        const recordId = odataEntityId.split("(")[1].split(")")[0];
        return recordId;
      }
    }

    throw new Error(`Failed to create record: ${await response.text()}`);
  }

  /**
   * Validates that all required attributes are provided in the data object
   * @param service - The Dataverse Web API service
   * @param tableName - The logical name of the table
   * @param data - The data object to validate
   * @throws Error if any required attributes are missing
   */
  private async validateRequiredAttributes(
    service: DataverseWebApiService,
    tableName: string,
    data: Record<string, any>
  ): Promise<void> {
    logger.debug(`Validating required attributes for table '${tableName}'`);

    const tableDescription = await this.metadataService.describeTable(
      service,
      tableName,
      true // Get full metadata to ensure we have all required fields
    );

    const missingRequiredFields: string[] = [];

    // Fields that are system-managed and should not be validated as required
    const systemManagedFields = [
      "statecode",
      "statuscode",
      "ownerid",
      "owneridtype",
      "transactioncurrencyid",
      "createdby",
      "createdon",
      "modifiedby",
      "modifiedon",
      "versionnumber",
    ];

    logger.debug(
      `System-managed fields that will be skipped: ${systemManagedFields.join(
        ", "
      )}`
    );

    const requiredFields = tableDescription.attributes.filter(
      (attr) =>
        attr.isRequired &&
        !attr.isReadOnly &&
        attr.logicalName !== tableDescription.primaryIdAttribute
    );

    logger.debug(
      `Found ${requiredFields.length} required fields: ${requiredFields
        .map((f) => f.logicalName)
        .join(", ")}`
    );

    for (const attribute of tableDescription.attributes) {
      // Check if the attribute is required for create operations
      if (
        attribute.isRequired &&
        !attribute.isReadOnly &&
        attribute.logicalName !== tableDescription.primaryIdAttribute
      ) {
        // Skip system-managed fields that Dataverse handles automatically
        if (systemManagedFields.includes(attribute.logicalName)) {
          logger.debug(
            `Skipping system-managed field: ${attribute.logicalName}`
          );
          continue;
        }

        // Check if the field is provided in the data
        const isProvided = data.hasOwnProperty(attribute.logicalName);

        // Special handling for lookup fields (they might use @odata.bind suffix)
        const isLookupProvided =
          (attribute.type === "Lookup" ||
            attribute.type === "Customer" ||
            attribute.type === "Owner") &&
          data.hasOwnProperty(`${attribute.logicalName}@odata.bind`);

        logger.debug(
          `Checking required field '${attribute.logicalName}' (${attribute.type}): isProvided=${isProvided}, isLookupProvided=${isLookupProvided}`
        );

        if (!isProvided && !isLookupProvided) {
          logger.debug(`Required field '${attribute.logicalName}' is MISSING`);
          missingRequiredFields.push(
            `${attribute.logicalName} (${attribute.displayName})`
          );
        } else {
          logger.debug(
            `Required field '${
              attribute.logicalName
            }' is provided with value: ${JSON.stringify(
              data[attribute.logicalName] ||
                data[`${attribute.logicalName}@odata.bind`]
            )}`
          );
        }
      }
    }

    if (missingRequiredFields.length > 0) {
      const fieldList = missingRequiredFields
        .map((field) => `  - ${field}`)
        .join("\n");

      logger.error(
        `Validation failed for table '${tableName}': Missing ${missingRequiredFields.length} required field(s)`
      );

      throw new Error(
        `Cannot create record in table '${tableName}': Missing required attributes:\n${fieldList}\n\nUse describe_table to see all required fields and their data types.`
      );
    }

    logger.debug(
      `Validation successful for table '${tableName}' - all required fields provided`
    );
  }

  async updateRecord(
    service: DataverseWebApiService,
    tableName: string,
    recordId: string,
    data: Record<string, any>
  ): Promise<void> {
    const entitySetName = await this.metadataService.getEntitySetName(
      service,
      tableName
    );
    const processedData = await this.processPayload(
      service,
      tableName,
      data,
      recordId
    );
    const response = await service.updateRecord(
      entitySetName,
      recordId,
      processedData
    );

    if (!response.ok) {
      throw new Error(`Failed to update record: ${await response.text()}`);
    }
  }

  private async processPayload(
    service: DataverseWebApiService,
    tableName: string,
    data: Record<string, any>,
    recordId?: string
  ): Promise<Record<string, any>> {
    const tableDescription = await this.metadataService.describeTable(
      service,
      tableName,
      true
    );
    const processedData: Record<string, any> = {};

    // Pre-process: Handle special patterns like ownerid + owneridtype
    const normalizedData = this.normalizeSpecialPatterns(data);

    for (const key in normalizedData) {
      if (Object.prototype.hasOwnProperty.call(normalizedData, key)) {
        const attribute = tableDescription.attributes.find(
          (attr) => attr.logicalName === key
        );
        if (attribute) {
          const value = normalizedData[key];
          // Data conversion logic
          // Use AttributeTypeName.Value (recommended) which returns values like "LookupType", "CustomerType", "OwnerType"
          // Reference: https://learn.microsoft.com/en-us/dotnet/api/microsoft.xrm.sdk.metadata.attributemetadata.attributetypename
          if (
            attribute.type === "LookupType" ||
            attribute.type === "CustomerType" ||
            attribute.type === "OwnerType"
          ) {
            processedData[`${key}@odata.bind`] = await this.resolveLookup(
              service,
              attribute,
              value
            );
          } else if (
            attribute.type === "PicklistType" ||
            attribute.type === "StateType" ||
            attribute.type === "StatusType"
          ) {
            processedData[key] = await this.resolveOptionSet(attribute, value);
          } else {
            processedData[key] = value;
          }
        } else {
          // Handle unknown attributes if necessary
          processedData[key] = normalizedData[key];
        }
      }
    }

    // Auto-add transaction currency if not provided
    if (
      tableDescription.attributes.some(
        (attr) => attr.logicalName === "transactioncurrencyid"
      ) &&
      !data.hasOwnProperty("transactioncurrencyid")
    ) {
      const currencyId = await service.getOrganizationBaseCurrencyId();
      const entitySetName = await this.metadataService.getEntitySetName(
        service,
        "transactioncurrency"
      );
      processedData[
        "transactioncurrencyid@odata.bind"
      ] = `/${entitySetName}(${currencyId})`;
    }

    return processedData;
  }

  private async resolveLookup(
    service: DataverseWebApiService,
    attribute: AttributeDescription,
    value: any
  ): Promise<string> {
    // b) webapi style reference '<entityset>(<guid>)'
    if (
      typeof value === "string" &&
      value.includes("(") &&
      value.includes(")")
    ) {
      return value;
    }

    // a) guid only
    if (isGuid(value)) {
      if (attribute.targets && attribute.targets.length === 1) {
        const targetEntity = attribute.targets[0];
        const entitySetName = await this.metadataService.getEntitySetName(
          service,
          targetEntity
        );
        return `/${entitySetName}(${value})`;
      } else {
        throw new Error(
          `Lookup for attribute ${attribute.logicalName} is polymorphic. Please provide the entity set name.`
        );
      }
    }

    // c) webapi style primary key
    if (typeof value === "string" && value.includes("=")) {
      const parts = value.split("=");
      const entitySetName = await this.metadataService.getEntitySetName(
        service,
        parts[0]
      );
      return `/${entitySetName}(${parts[1]})`;
    }

    // d) primary name of the referenced entity
    if (typeof value === "string" && attribute.targets) {
      for (const target of attribute.targets) {
        const tableDescription = await this.metadataService.describeTable(
          service,
          target,
          false
        );
        if (tableDescription.primaryNameAttribute) {
          const entitySetName = await this.metadataService.getEntitySetName(
            service,
            target
          );
          try {
            const escapedValue = escapeODataValue(value);
            const record = await service.retrieveRecordByAlternateKey(
              entitySetName,
              tableDescription.primaryNameAttribute,
              escapedValue
            );
            if (record && record.value && record.value.length === 1) {
              const recordId = record.value[0][`${target}id`];
              return `/${entitySetName}(${recordId})`;
            }
          } catch (error) {
            // ignore and try next target
          }
        }
      }
    }

    throw new Error(
      `Could not resolve lookup value for attribute ${attribute.logicalName}`
    );
  }

  private async resolveOptionSet(
    attribute: AttributeDescription,
    value: any
  ): Promise<number> {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && attribute.optionSet) {
      const matchingOptions = attribute.optionSet.filter(
        (option) => option.label === value
      );
      if (matchingOptions.length === 1) {
        return matchingOptions[0].value;
      } else if (matchingOptions.length > 1) {
        throw new Error(
          `Option set value '${value}' for attribute ${attribute.logicalName} is not unique.`
        );
      }
    }

    throw new Error(
      `Could not resolve option set value for attribute ${attribute.logicalName}`
    );
  }

  /**
   * Normalizes special input patterns that clients might use
   * For example: ownerid + owneridtype -> ownerid with entity type prefix
   */
  private normalizeSpecialPatterns(
    data: Record<string, any>
  ): Record<string, any> {
    const normalized: Record<string, any> = { ...data };

    // Handle pattern: ownerid + owneridtype
    // Client provides: { "ownerid": "guid", "owneridtype": "systemuser" }
    // Convert to: { "ownerid": "systemuser=guid" }
    if (normalized.ownerid && normalized.owneridtype) {
      const ownerGuid = normalized.ownerid;
      const ownerType = normalized.owneridtype;

      // Convert to entity=guid format which resolveLookup can handle
      normalized.ownerid = `${ownerType}=${ownerGuid}`;

      // Remove the type field as it's been merged
      delete normalized.owneridtype;

      logger.debug(
        `Normalized ownerid pattern: ownerid="${ownerGuid}", owneridtype="${ownerType}" -> ownerid="${normalized.ownerid}"`
      );
    }

    // Handle pattern: regardingobjectid + regardingobjecttypecode (similar polymorphic lookup)
    if (normalized.regardingobjectid && normalized.regardingobjecttypecode) {
      const regardingGuid = normalized.regardingobjectid;
      const regardingType = normalized.regardingobjecttypecode;

      normalized.regardingobjectid = `${regardingType}=${regardingGuid}`;
      delete normalized.regardingobjecttypecode;

      logger.debug(
        `Normalized regardingobjectid pattern: regardingobjectid="${regardingGuid}", regardingobjecttypecode="${regardingType}" -> regardingobjectid="${normalized.regardingobjectid}"`
      );
    }

    // Handle any other *id + *type or *id + *typecode patterns
    const typePatterns = [
      { idSuffix: "id", typeSuffix: "type" },
      { idSuffix: "id", typeSuffix: "typecode" },
      { idSuffix: "objectid", typeSuffix: "objecttypecode" },
    ];

    for (const key in normalized) {
      for (const pattern of typePatterns) {
        // Check if this key ends with the type suffix
        if (key.endsWith(pattern.typeSuffix)) {
          // Derive the corresponding ID field name
          const baseFieldName = key.substring(
            0,
            key.length - pattern.typeSuffix.length
          );
          const idFieldName = baseFieldName + pattern.idSuffix;

          // If both the ID and type fields exist, merge them
          if (
            normalized[idFieldName] &&
            !idFieldName.includes("owner") &&
            !idFieldName.includes("regarding")
          ) {
            const idValue = normalized[idFieldName];
            const typeValue = normalized[key];

            normalized[idFieldName] = `${typeValue}=${idValue}`;
            delete normalized[key];

            logger.debug(
              `Normalized polymorphic lookup pattern: ${idFieldName}="${idValue}", ${key}="${typeValue}" -> ${idFieldName}="${normalized[idFieldName]}"`
            );
          }
        }
      }
    }

    return normalized;
  }
}
