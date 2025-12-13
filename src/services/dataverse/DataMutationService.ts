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
    const entitySetName = await this.metadataService.getEntitySetName(
      service,
      tableName
    );
    const processedData = await this.processPayload(service, tableName, data);
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

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const attribute = tableDescription.attributes.find(
          (attr) => attr.logicalName === key
        );
        if (attribute) {
          const value = data[key];
          // Data conversion logic
          if (
            attribute.type === "Lookup" ||
            attribute.type === "Customer" ||
            attribute.type === "Owner"
          ) {
            processedData[`${key}@odata.bind`] = await this.resolveLookup(
              service,
              attribute,
              value
            );
          } else if (
            attribute.type === "Picklist" ||
            attribute.type === "State" ||
            attribute.type === "Status"
          ) {
            processedData[key] = await this.resolveOptionSet(attribute, value);
          } else {
            processedData[key] = value;
          }
        } else {
          // Handle unknown attributes if necessary
          processedData[key] = data[key];
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
}
