import {
  registerDataverseTools,
  RequestContextProvider,
} from "../dataverse/toolRegistration.js";
import type { DataverseClient as DataverseClientType } from "../../services/dataverse/DataverseClient.js";

jest.mock("../../services/dataverse/DataverseClient.js", () => {
  const methods = {
    resolveLogicalName: jest.fn(),
    describeTable: jest.fn(),
  };
  return {
    DataverseClient: jest.fn(() => methods),
  };
});
import { DataverseClient } from "../../services/dataverse/DataverseClient.js";

describe("Describe Table Tool Integration", () => {
  let server: { tool: jest.Mock };
  let mockDataverseClient: jest.Mocked<DataverseClientType>;
  let contextProvider: RequestContextProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    const toolMock = jest.fn();
    server = {
      tool: toolMock,
      registerTool: toolMock,
    } as any;
    mockDataverseClient =
      new (DataverseClient as unknown as jest.Mock<DataverseClientType>)() as jest.Mocked<DataverseClientType>;
    contextProvider = {
      getContext: () => undefined,
      getUserInfo: () => "test-user",
    };
    registerDataverseTools(server as any, mockDataverseClient, contextProvider);
  });

  it("registers describe_table and calls DataverseClient.describeTable", async () => {
    const call = server.tool.mock.calls.find((c) => c[0] === "describe_table");
    expect(call).toBeDefined();
    const handler = call![2];

    mockDataverseClient.resolveLogicalName.mockResolvedValue("account");
    mockDataverseClient.describeTable.mockResolvedValue({
      logicalName: "account",
      displayName: "Account",
      description: "Accounts",
      primaryIdAttribute: "accountid",
      primaryNameAttribute: "name",
      attributes: [
        {
          logicalName: "name",
          displayName: "Name",
          description: "",
          type: "String",
          flags: "PrimaryName",
          exampleValue: "Contoso",
        } as any,
      ],
      sampleRecord: { name: "Contoso" },
    } as any);

    const params = { tableName: "account", full: false, format: "json" } as any;
    const result = await handler(params);

    expect(mockDataverseClient.describeTable).toHaveBeenCalledWith(
      "account",
      false,
      undefined,
    );
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining('"table": {'),
        }),
      ]),
    );
  });
});
