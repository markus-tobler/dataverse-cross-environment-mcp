import { DataverseClient } from "../DataverseClient.js";
import { DataverseWebApiService } from "../DataverseWebApiService.js";
import {
  createDataverseResponse,
  setFetchHandler,
} from "../../../test/helpers.js";
import { DataverseConfig } from "../../../types/dataverse.js";

// Mock the underlying service. Jest will use our mock from src/__mocks__
jest.mock("../DataverseWebApiService.js");
// Stub auth providers to avoid import.meta issues during test compilation
jest.mock(
  "../../auth/InteractiveAuthProvider.js",
  () => ({
    InteractiveAuthProvider: class {
      constructor(..._args: any[]) {}
      async getAccessToken() {
        return "token";
      }
    },
  }),
  { virtual: true },
);
jest.mock(
  "../../auth/OboAuthProvider.js",
  () => ({
    OboAuthProvider: class {
      constructor(..._args: any[]) {}
      async getAccessToken() {
        return "token";
      }
    },
  }),
  { virtual: true },
);

describe("DataverseClient", () => {
  let client: DataverseClient;
  let mockApiService: jest.Mocked<DataverseWebApiService>;

  const config: DataverseConfig = {
    url: "https://fake.crm.dynamics.com",
    apiVersion: "9.2",
    getAccessToken: async () => "fake-token",
  };

  beforeEach(async () => {
    // Reset mocks and handlers before each test
    jest.clearAllMocks();
    setFetchHandler(async () =>
      createDataverseResponse.error(500, "Unhandled request"),
    );

    // Configure a default successful WhoAmI for initialization
    setFetchHandler(async (url: string) => {
      if (url.endsWith("WhoAmI")) {
        return createDataverseResponse.whoAmI();
      }
      return createDataverseResponse.error(404, "Not Found");
    });

    // Instantiate the client, which uses the mocked DataverseWebApiService
    client = new DataverseClient(config);
    await client.initialize(); // Initialize to mimic real-world usage

    // Get the mocked instance created by the DataverseClient
    mockApiService = (DataverseWebApiService as jest.Mock).mock
      .instances[0] as jest.Mocked<DataverseWebApiService>;
  });

  describe("whoAmI", () => {
    it("should return user information from the api service", async () => {
      const fakeService: any = {
        initialize: jest.fn(async () => {}),
        getUserId: () => "user-guid-test",
        getBusinessUnitId: () => "bu-guid-test",
        getOrganizationId: () => "org-guid-test",
      };
      jest
        .spyOn(DataverseClient.prototype as any, "createDataverseService")
        .mockResolvedValue(fakeService);

      const testClient = new DataverseClient(config);
      const result = await testClient.whoAmI();

      expect(result).toEqual({
        UserId: "user-guid-test",
        BusinessUnitId: "bu-guid-test",
        OrganizationId: "org-guid-test",
      });
    });
  });

  describe("search", () => {
    it("should perform a search and return formatted results", async () => {
      const searchTerm = "contoso";
      const fakeService: any = {
        initialize: jest.fn(async () => {}),
        getAccessTokenFunc: () => async () => "token",
        sendRequestString: jest.fn(async () =>
          JSON.stringify({
            response: JSON.stringify({
              Value: [
                {
                  EntityName: "account",
                  Id: "acc-guid-1",
                  Attributes: { name: "Contoso Corp" },
                },
                {
                  EntityName: "contact",
                  Id: "con-guid-1",
                  Attributes: { fullname: "John Doe (Contoso)" },
                },
              ],
              Count: 2,
            }),
          }),
        ),
        getDataverseUrl: () => "https://fake.crm.dynamics.com",
      };
      jest
        .spyOn(DataverseClient.prototype as any, "createDataverseService")
        .mockResolvedValue(fakeService);

      const result = await client.search(searchTerm, 10, undefined);

      expect(fakeService.sendRequestString).toHaveBeenCalledWith(
        "token",
        "POST",
        "searchquery",
        expect.objectContaining({ search: searchTerm }),
      );
      expect(result.totalRecordCount).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          tableName: "account",
          recordId: "acc-guid-1",
          primaryName: "Contoso Corp",
        }),
      );
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          tableName: "contact",
          recordId: "con-guid-1",
          primaryName: "John Doe (Contoso)",
        }),
      );
    });
  });
});
