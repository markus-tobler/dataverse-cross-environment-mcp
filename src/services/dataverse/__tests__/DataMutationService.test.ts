import { DataMutationService } from "../DataMutationService.js";
import { MetadataService } from "../MetadataService.js";
import { DataverseWebApiService } from "../DataverseWebApiService.js";
import { TableDescription } from "../../../types/dataverse.js";

// Mock the MetadataService
jest.mock("../MetadataService.js");

describe("DataMutationService", () => {
  let mutationService: DataMutationService;
  let mockMetadataService: jest.Mocked<MetadataService>;
  let mockWebApiService: jest.Mocked<DataverseWebApiService>;

  beforeEach(() => {
    // Create mock instances
    mockMetadataService = new MetadataService() as jest.Mocked<MetadataService>;
    mutationService = new DataMutationService(mockMetadataService);

    // Create mock Web API service
    mockWebApiService = {
      getDataverseUrl: jest
        .fn()
        .mockReturnValue("https://fake.crm.dynamics.com"),
      getAccessTokenFunc: jest.fn().mockReturnValue(async () => "fake-token"),
      createRecord: jest.fn(),
      updateRecord: jest.fn(),
      getOrganizationBaseCurrencyId: jest
        .fn()
        .mockResolvedValue("12345678-1234-1234-1234-123456789abc"),
    } as any;
  });

  describe("createRecord - Required Fields Validation", () => {
    it("should create a record when all required fields are provided", async () => {
      const mockTableDescription: TableDescription = {
        logicalName: "account",
        displayName: "Account",
        primaryIdAttribute: "accountid",
        primaryNameAttribute: "name",
        attributes: [
          {
            logicalName: "accountid",
            displayName: "Account ID",
            type: "Uniqueidentifier",
            flags: "PrimaryId|ReadOnly",
            exampleValue: "00000000-0000-0000-0000-000000000000",
          },
          {
            logicalName: "name",
            displayName: "Account Name",
            type: "String",
            flags: "PrimaryName|Required",
            exampleValue: "Contoso Ltd",
          },
        ],
        sampleRecord: {},
      };

      mockMetadataService.describeTable = jest
        .fn()
        .mockResolvedValue(mockTableDescription);
      mockMetadataService.getEntitySetName = jest
        .fn()
        .mockResolvedValue("accounts");

      mockWebApiService.createRecord = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest
            .fn()
            .mockReturnValue(
              "https://fake.crm.dynamics.com/api/data/v9.2/accounts(12345678-1234-1234-1234-123456789abc)",
            ),
        },
      });

      const recordData = {
        name: "Test Account",
      };

      const recordId = await mutationService.createRecord(
        mockWebApiService,
        "account",
        recordData,
      );

      expect(recordId).toBe("12345678-1234-1234-1234-123456789abc");
      expect(mockMetadataService.describeTable).toHaveBeenCalledWith(
        mockWebApiService,
        "account",
        true,
      );
    });

    it("should throw an error when a required field is missing", async () => {
      const mockTableDescription: TableDescription = {
        logicalName: "account",
        displayName: "Account",
        primaryIdAttribute: "accountid",
        primaryNameAttribute: "name",
        attributes: [
          {
            logicalName: "accountid",
            displayName: "Account ID",
            type: "Uniqueidentifier",
            flags: "PrimaryId|ReadOnly",
            exampleValue: "00000000-0000-0000-0000-000000000000",
          },
          {
            logicalName: "name",
            displayName: "Account Name",
            type: "String",
            flags: "PrimaryName|Required",
            exampleValue: "Contoso Ltd",
          },
          {
            logicalName: "emailaddress1",
            displayName: "Email",
            type: "String",
            flags: "Required",
            exampleValue: "test@example.com",
          },
        ],
        sampleRecord: {},
      };

      mockMetadataService.describeTable = jest
        .fn()
        .mockResolvedValue(mockTableDescription);

      const recordData = {
        name: "Test Account",
        // emailaddress1 is missing
      };

      await expect(
        mutationService.createRecord(mockWebApiService, "account", recordData),
      ).rejects.toThrow(/Missing required attributes/);

      await expect(
        mutationService.createRecord(mockWebApiService, "account", recordData),
      ).rejects.toThrow(/emailaddress1 \(Email\)/);
    });

    it("should throw an error when multiple required fields are missing", async () => {
      const mockTableDescription: TableDescription = {
        logicalName: "contact",
        displayName: "Contact",
        primaryIdAttribute: "contactid",
        primaryNameAttribute: "fullname",
        attributes: [
          {
            logicalName: "contactid",
            displayName: "Contact ID",
            type: "Uniqueidentifier",
            flags: "PrimaryId|ReadOnly",
            exampleValue: "00000000-0000-0000-0000-000000000000",
          },
          {
            logicalName: "firstname",
            displayName: "First Name",
            type: "String",
            flags: "Required",
            exampleValue: "John",
          },
          {
            logicalName: "lastname",
            displayName: "Last Name",
            type: "String",
            flags: "Required",
            exampleValue: "Doe",
          },
          {
            logicalName: "emailaddress1",
            displayName: "Email",
            type: "String",
            flags: "Required",
            exampleValue: "test@example.com",
          },
        ],
        sampleRecord: {},
      };

      mockMetadataService.describeTable = jest
        .fn()
        .mockResolvedValue(mockTableDescription);

      const recordData = {
        firstname: "John",
        // lastname and emailaddress1 are missing
      };

      await expect(
        mutationService.createRecord(mockWebApiService, "contact", recordData),
      ).rejects.toThrow(/Missing required attributes/);

      const error = await mutationService
        .createRecord(mockWebApiService, "contact", recordData)
        .catch((e) => e);

      expect(error.message).toContain("lastname (Last Name)");
      expect(error.message).toContain("emailaddress1 (Email)");
      expect(error.message).toContain("Use describe_table");
    });

    it("should not validate read-only required fields", async () => {
      const mockTableDescription: TableDescription = {
        logicalName: "account",
        displayName: "Account",
        primaryIdAttribute: "accountid",
        primaryNameAttribute: "name",
        attributes: [
          {
            logicalName: "accountid",
            displayName: "Account ID",
            type: "Uniqueidentifier",
            flags: "PrimaryId|Required|ReadOnly",
            exampleValue: "00000000-0000-0000-0000-000000000000",
          },
          {
            logicalName: "name",
            displayName: "Account Name",
            type: "String",
            flags: "PrimaryName|Required",
            exampleValue: "Contoso Ltd",
          },
          {
            logicalName: "createdon",
            displayName: "Created On",
            type: "DateTime",
            flags: "Required|ReadOnly",
            exampleValue: "2024-01-01T00:00:00Z",
          },
        ],
        sampleRecord: {},
      };

      mockMetadataService.describeTable = jest
        .fn()
        .mockResolvedValue(mockTableDescription);
      mockMetadataService.getEntitySetName = jest
        .fn()
        .mockResolvedValue("accounts");

      mockWebApiService.createRecord = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest
            .fn()
            .mockReturnValue(
              "https://fake.crm.dynamics.com/api/data/v9.2/accounts(12345678-1234-1234-1234-123456789abc)",
            ),
        },
      });

      const recordData = {
        name: "Test Account",
        // createdon is required but read-only, so it should not be validated
      };

      const recordId = await mutationService.createRecord(
        mockWebApiService,
        "account",
        recordData,
      );

      expect(recordId).toBe("12345678-1234-1234-1234-123456789abc");
    });

    it("should accept lookup fields with @odata.bind suffix", async () => {
      const mockTableDescription: TableDescription = {
        logicalName: "contact",
        displayName: "Contact",
        primaryIdAttribute: "contactid",
        primaryNameAttribute: "fullname",
        attributes: [
          {
            logicalName: "contactid",
            displayName: "Contact ID",
            type: "Uniqueidentifier",
            flags: "PrimaryId|ReadOnly",
            exampleValue: "00000000-0000-0000-0000-000000000000",
          },
          {
            logicalName: "firstname",
            displayName: "First Name",
            type: "String",
            flags: "Required",
            exampleValue: "John",
          },
          {
            logicalName: "parentcustomerid",
            displayName: "Parent Customer",
            type: "Lookup",
            flags: "Required",
            exampleValue: "12345678-1234-1234-1234-123456789abc",
            targets: ["account", "contact"],
          },
        ],
        sampleRecord: {},
      };

      mockMetadataService.describeTable = jest
        .fn()
        .mockResolvedValue(mockTableDescription);
      mockMetadataService.getEntitySetName = jest
        .fn()
        .mockResolvedValue("contacts");

      mockWebApiService.createRecord = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest
            .fn()
            .mockReturnValue(
              "https://fake.crm.dynamics.com/api/data/v9.2/contacts(12345678-1234-1234-1234-123456789abc)",
            ),
        },
      });

      const recordData = {
        firstname: "John",
        "parentcustomerid@odata.bind":
          "/accounts(12345678-1234-1234-1234-123456789abc)",
      };

      const recordId = await mutationService.createRecord(
        mockWebApiService,
        "contact",
        recordData,
      );

      expect(recordId).toBe("12345678-1234-1234-1234-123456789abc");
    });

    it("should skip validation for transactioncurrencyid as it is auto-added", async () => {
      const mockTableDescription: TableDescription = {
        logicalName: "opportunity",
        displayName: "Opportunity",
        primaryIdAttribute: "opportunityid",
        primaryNameAttribute: "name",
        attributes: [
          {
            logicalName: "opportunityid",
            displayName: "Opportunity ID",
            type: "Uniqueidentifier",
            flags: "PrimaryId|ReadOnly",
            exampleValue: "00000000-0000-0000-0000-000000000000",
          },
          {
            logicalName: "name",
            displayName: "Topic",
            type: "String",
            flags: "PrimaryName|Required",
            exampleValue: "Test Opportunity",
          },
          {
            logicalName: "transactioncurrencyid",
            displayName: "Currency",
            type: "Lookup",
            flags: "Required",
            exampleValue: "12345678-1234-1234-1234-123456789abc",
            targets: ["transactioncurrency"],
          },
        ],
        sampleRecord: {},
      };

      mockMetadataService.describeTable = jest
        .fn()
        .mockResolvedValue(mockTableDescription);
      mockMetadataService.getEntitySetName = jest
        .fn()
        .mockResolvedValue("opportunities");

      mockWebApiService.createRecord = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest
            .fn()
            .mockReturnValue(
              "https://fake.crm.dynamics.com/api/data/v9.2/opportunities(12345678-1234-1234-1234-123456789abc)",
            ),
        },
      });

      const recordData = {
        name: "Test Opportunity",
        // transactioncurrencyid is missing but should be auto-added
      };

      const recordId = await mutationService.createRecord(
        mockWebApiService,
        "opportunity",
        recordData,
      );

      expect(recordId).toBe("12345678-1234-1234-1234-123456789abc");
    });
  });
});
