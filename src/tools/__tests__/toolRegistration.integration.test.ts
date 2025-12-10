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

describe("Tool Registration Integration Tests", () => {
  let server: { tool: jest.Mock };
  let mockDataverseClient: jest.Mocked<DataverseClient>;
  let contextProvider: RequestContextProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    server = { tool: jest.fn() } as any;
    mockDataverseClient =
      new (DataverseClient as jest.Mock<DataverseClient>)() as jest.Mocked<DataverseClient>;

    contextProvider = {
      getContext: () => undefined,
      getUserInfo: () => "test-user",
    };

    registerDataverseTools(server as any, mockDataverseClient, contextProvider);
  });

  it("registers whoami tool and calls DataverseClient.whoAmI", async () => {
    const whoAmIResponse = {
      UserId: "user-guid-from-mock",
      BusinessUnitId: "bu-guid-from-mock",
      OrganizationId: "org-guid-from-mock",
    };
    mockDataverseClient.whoAmI.mockResolvedValue(whoAmIResponse);

    // Find registration by name
    const call = server.tool.mock.calls.find((c) => c[0] === "whoami");
    expect(call).toBeDefined();
    const handler = call![3];

    const result = await handler({});
    expect(mockDataverseClient.whoAmI).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining(whoAmIResponse.UserId),
        }),
      ])
    );
  });

  it("registers search tool and calls DataverseClient.search", async () => {
    const searchParams = { searchTerm: "test search", top: 5 } as any;
    const searchResponse = {
      totalRecordCount: 1,
      results: [
        {
          tableName: "account",
          recordId: "account-id-1",
          primaryName: "Test Account",
          deepLink: "http://x",
          attributes: { name: "Test Account" },
        },
      ],
    };
    mockDataverseClient.search.mockResolvedValue(searchResponse);

    const call = server.tool.mock.calls.find((c) => c[0] === "search");
    expect(call).toBeDefined();
    const handler = call![3];

    const result = await handler(searchParams);
    expect(mockDataverseClient.search).toHaveBeenCalledWith(
      "test search",
      undefined,
      5,
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
  });
});
