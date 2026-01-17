import {
  registerDataverseTools,
  RequestContextProvider,
} from "../dataverse/toolRegistration.js";
import type { DataverseClient as DataverseClientType } from "../../services/dataverse/DataverseClient.js";

jest.mock("../../services/dataverse/DataverseClient.js", () => {
  const methods = {
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
  };
  return {
    DataverseClient: jest.fn(() => methods),
  };
});
import { DataverseClient } from "../../services/dataverse/DataverseClient.js";

describe("create_record and update_record tools", () => {
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

  it("registers create_record and calls DataverseClient.createRecord", async () => {
    const call = server.tool.mock.calls.find((c) => c[0] === "create_record");
    expect(call).toBeDefined();
    const handler = call![2]; // Handler is the 3rd argument (index 2)

    mockDataverseClient.createRecord.mockResolvedValue(
      "00000000-0000-0000-0000-000000000001"
    );

    const params = {
      table: "account",
      data: { name: "Test Account" },
    };

    const result = await handler(params);

    expect(mockDataverseClient.createRecord).toHaveBeenCalledWith(
      "account",
      { name: "Test Account" },
      undefined
    );
    expect(result.content[0].text).toContain(
      "Successfully created record with ID: 00000000-0000-0000-0000-000000000001"
    );
  });

  it("registers update_record and calls DataverseClient.updateRecord", async () => {
    const call = server.tool.mock.calls.find((c) => c[0] === "update_record");
    expect(call).toBeDefined();
    const handler = call![2]; // Handler is the 3rd argument (index 2)

    mockDataverseClient.updateRecord.mockResolvedValue(undefined);

    const params = {
      table: "account",
      record_id: "00000000-0000-0000-0000-000000000001",
      data: { name: "Updated Account" },
    };

    const result = await handler(params);

    expect(mockDataverseClient.updateRecord).toHaveBeenCalledWith(
      "account",
      "00000000-0000-0000-0000-000000000001",
      { name: "Updated Account" },
      undefined
    );
    expect(result.content[0].text).toContain(
      "Successfully updated record with ID: 00000000-0000-0000-0000-000000000001"
    );
  });

  it("handles errors in create_record", async () => {
    const call = server.tool.mock.calls.find((c) => c[0] === "create_record");
    const handler = call![2]; // Handler is the 3rd argument (index 2)

    mockDataverseClient.createRecord.mockRejectedValue(
      new Error("Creation failed")
    );

    const params = {
      table: "account",
      data: { name: "Test Account" },
    };

    const result = await handler(params);

    expect(result.content[0].text).toContain(
      "Error creating record in table 'account'"
    );
    expect(result.content[0].text).toContain("Creation failed");
  });
});
