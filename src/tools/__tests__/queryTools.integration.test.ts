import { DataverseClient } from "../../services/dataverse/DataverseClient.js";
import {
  registerDataverseTools,
  RequestContextProvider,
} from "../dataverse/toolRegistration.js";

// Mock DataverseClient
jest.mock("../../services/dataverse/DataverseClient.js");
// Stub out auth providers that use import.meta to avoid ts-jest module issues
jest.mock("../../services/auth/InteractiveAuthProvider.js", () => ({}), {
  virtual: true,
});
jest.mock("../../services/auth/OboAuthProvider.js", () => ({}), {
  virtual: true,
});

describe("Query Tools Integration Tests", () => {
  let server: { tool: jest.Mock };
  let mockDataverseClient: jest.Mocked<DataverseClient>;
  let contextProvider: RequestContextProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    const toolMock = jest.fn();
    server = {
      tool: toolMock,
      registerTool: toolMock,
    } as any;
    mockDataverseClient =
      new (DataverseClient as jest.Mock<DataverseClient>)() as jest.Mocked<DataverseClient>;

    contextProvider = {
      getContext: () => undefined,
      getUserInfo: () => "test-user",
    };

    registerDataverseTools(server as any, mockDataverseClient, contextProvider);
  });

  describe("get_predefined_queries", () => {
    it("registers get_predefined_queries tool and calls DataverseClient.getPredefinedQueries", async () => {
      const mockQueries = [
        { id: "query-1", type: "savedquery" as const, name: "Active Accounts" },
        { id: "query-2", type: "userquery" as const, name: "My Custom View" },
      ];
      mockDataverseClient.getPredefinedQueries.mockResolvedValue(mockQueries);

      const call = server.tool.mock.calls.find(
        (c) => c[0] === "get_predefined_queries"
      );
      expect(call).toBeDefined();
      const handler = call![2];

      const result = await handler({ tableName: "account" });
      expect(mockDataverseClient.getPredefinedQueries).toHaveBeenCalledWith(
        "account",
        undefined
      );
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining('"count": 2'),
          }),
        ])
      );
      expect(result.content[0].text).toContain("Active Accounts");
      expect(result.content[0].text).toContain("My Custom View");
    });

    it("handles errors when fetching predefined queries", async () => {
      mockDataverseClient.getPredefinedQueries.mockRejectedValue(
        new Error("Table not found")
      );

      const call = server.tool.mock.calls.find(
        (c) => c[0] === "get_predefined_queries"
      );
      const handler = call![2];

      const result = await handler({ tableName: "nonexistent" });
      expect(result.content[0].text).toContain('"error": true');
      expect(result.content[0].text).toContain("Table not found");
    });
  });

  describe("run_predefined_query", () => {
    it("registers run_predefined_query tool and calls DataverseClient.runPredefinedQuery", async () => {
      const mockResult = {
        tableName: "account",
        totalRecordCount: 2,
        records: [
          {
            recordId: "record-1",
            attributes: { name: "Account 1" },
            deepLink: "http://example.com/record-1",
          },
          {
            recordId: "record-2",
            attributes: { name: "Account 2" },
            deepLink: "http://example.com/record-2",
          },
        ],
      };
      mockDataverseClient.runPredefinedQuery.mockResolvedValue(mockResult);

      const call = server.tool.mock.calls.find(
        (c) => c[0] === "run_predefined_query"
      );
      expect(call).toBeDefined();
      const handler = call![2];

      const result = await handler({
        queryIdOrName: "query-id-123",
        tableName: "account",
      });
      expect(mockDataverseClient.runPredefinedQuery).toHaveBeenCalledWith(
        "query-id-123",
        "account",
        undefined
      );
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining('"total_record_count": 2'),
          }),
        ])
      );

      // Check for resource links
      const resourceLinks = result.content.filter(
        (c: any) => c.type === "resource_link"
      );
      expect(resourceLinks).toHaveLength(2);
      expect(resourceLinks[0].uri).toBe("dataverse:///account/record-1");
    });

    it("handles errors when running predefined query", async () => {
      mockDataverseClient.runPredefinedQuery.mockRejectedValue(
        new Error("Query not found")
      );

      const call = server.tool.mock.calls.find(
        (c) => c[0] === "run_predefined_query"
      );
      const handler = call![2];

      const result = await handler({ queryIdOrName: "nonexistent" });
      expect(result.content[0].text).toContain('"error": true');
      expect(result.content[0].text).toContain("Query");
    });
  });

  describe("run_custom_query", () => {
    it("registers run_custom_query tool and calls DataverseClient.runCustomQuery", async () => {
      const mockResult = {
        tableName: "contact",
        totalRecordCount: 1,
        records: [
          {
            recordId: "contact-1",
            attributes: { firstname: "John", lastname: "Doe" },
            deepLink: "http://example.com/contact-1",
          },
        ],
      };
      mockDataverseClient.runCustomQuery.mockResolvedValue(mockResult);

      const call = server.tool.mock.calls.find(
        (c) => c[0] === "run_custom_query"
      );
      expect(call).toBeDefined();
      const handler = call![2];

      const fetchXml =
        '<fetch><entity name="contact"><attribute name="firstname"/></entity></fetch>';
      const result = await handler({ fetchXml, tableName: "contact" });
      expect(mockDataverseClient.runCustomQuery).toHaveBeenCalledWith(
        fetchXml,
        "contact",
        undefined
      );
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining('"total_record_count": 1'),
          }),
        ])
      );

      // Check for resource links
      const resourceLinks = result.content.filter(
        (c: any) => c.type === "resource_link"
      );
      expect(resourceLinks).toHaveLength(1);
      expect(resourceLinks[0].uri).toBe("dataverse:///contact/contact-1");
    });

    it("handles FetchXML errors with detailed messages", async () => {
      mockDataverseClient.runCustomQuery.mockRejectedValue(
        new Error("Invalid FetchXML query: The FetchXML syntax is invalid")
      );

      const call = server.tool.mock.calls.find(
        (c) => c[0] === "run_custom_query"
      );
      const handler = call![2];

      const fetchXml = "<fetch><bad-xml></fetch>";
      const result = await handler({ fetchXml });
      expect(result.content[0].text).toContain('"error": true');
      expect(result.content[0].text).toContain("Invalid FetchXML");
    });

    it("includes Dataverse error details when available", async () => {
      const dataverseError = new Error(
        'Dataverse API request failed with status 400: {"error":{"code":"0x80040203","message":"Invalid FetchXml. Entity \'badentity\' could not be found."}}'
      );
      mockDataverseClient.runCustomQuery.mockRejectedValue(dataverseError);

      const call = server.tool.mock.calls.find(
        (c) => c[0] === "run_custom_query"
      );
      const handler = call![2];

      const fetchXml = '<fetch><entity name="badentity"></entity></fetch>';
      const result = await handler({ fetchXml });

      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe(true);
      expect(response.dataverse_error).toBeDefined();
      expect(response.dataverse_error.error.code).toBe("0x80040203");
      expect(response.dataverse_error.error.message).toContain("badentity");
    });
  });
});
