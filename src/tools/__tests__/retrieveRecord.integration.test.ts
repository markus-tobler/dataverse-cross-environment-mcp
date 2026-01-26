import {
  registerDataverseTools,
  RequestContextProvider,
} from "../dataverse/toolRegistration.js";
import type { DataverseClient as DataverseClientType } from "../../services/dataverse/DataverseClient.js";

jest.mock("../../services/dataverse/DataverseClient.js", () => {
  const methods = {
    resolveLogicalName: jest.fn(),
    retrieveRecord: jest.fn(),
  };
  return {
    DataverseClient: jest.fn(() => methods),
  };
});
import { DataverseClient } from "../../services/dataverse/DataverseClient.js";

describe("Retrieve Record Tool Integration", () => {
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

  it("registers retrieve_record and calls DataverseClient.retrieveRecord", async () => {
    const call = server.tool.mock.calls.find((c) => c[0] === "retrieve_record");
    expect(call).toBeDefined();
    const handler = call![2];

    mockDataverseClient.resolveLogicalName.mockResolvedValue("account");
    mockDataverseClient.retrieveRecord.mockResolvedValue({
      _deepLink: "http://x",
      name: "Contoso",
      id: "guid-1",
    } as any);

    const params = {
      tableName: "account",
      recordId: "guid-1",
      allColumns: false,
    } as any;
    const result = await handler(params);

    expect(mockDataverseClient.retrieveRecord).toHaveBeenCalledWith(
      "account",
      "guid-1",
      undefined,
      false,
    );
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining('"table_name": "account"'),
        }),
        expect.objectContaining({
          type: "resource_link",
          uri: "dataverse:///account/guid-1",
        }),
      ]),
    );
  });
});
