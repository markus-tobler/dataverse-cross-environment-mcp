import { Request } from "express";
import {
  SearchResponse,
  TableDescription,
  TableMetadata,
  WhoAmIResponse,
} from "../../types/dataverse.js";
import { ConnectionStringParams } from "../../utils/connectionStringParser.js";
import { AuthService } from "./AuthService.js";
import { DataService } from "./DataService.js";
import { DataverseWebApiService } from "./DataverseWebApiService.js";
import { MetadataService } from "./MetadataService.js";

export class DataverseClient {
  private authService: AuthService;
  private dataService: DataService;
  private metadataService: MetadataService;

  constructor(configOrParams: any | ConnectionStringParams) {
    this.authService = new AuthService(configOrParams);
    this.metadataService = new MetadataService();
    this.dataService = new DataService(this.metadataService);
  }

  async initialize(): Promise<void> {
    await this.authService.initialize();
    MetadataService.clearImportantColumnsCache();
  }

  private async createDataverseService(
    req?: Request
  ): Promise<DataverseWebApiService> {
    const config = this.authService.getConfig();
    const getAccessToken = async () => {
      return this.authService.getAccessToken(req);
    };

    const dataverseConfig = config.Dataverse || config;

    const service = new DataverseWebApiService({
      url: dataverseConfig.url || dataverseConfig.Url,
      apiVersion: dataverseConfig.apiVersion || dataverseConfig.ApiVersion,
      getAccessToken,
    });
    await service.initialize();
    return service;
  }

  async whoAmI(req?: Request): Promise<WhoAmIResponse> {
    const service = await this.createDataverseService(req);
    return {
      UserId: service.getUserId() || "",
      BusinessUnitId: service.getBusinessUnitId() || "",
      OrganizationId: service.getOrganizationId() || "",
    };
  }

  async listTables(req?: Request): Promise<TableMetadata[]> {
    const service = await this.createDataverseService(req);
    return this.metadataService.listTables(service);
  }

  async search(
    searchTerm: string,
    tableFilter?: string | string[],
    top: number = 10,
    req?: Request
  ): Promise<SearchResponse> {
    const service = await this.createDataverseService(req);
    return this.dataService.search(service, searchTerm, tableFilter, top);
  }

  async retrieveRecord(
    tableName: string,
    recordId: string,
    req?: Request,
    allColumns: boolean = false
  ): Promise<Record<string, any>> {
    const service = await this.createDataverseService(req);
    return this.dataService.retrieveRecord(
      service,
      tableName,
      recordId,
      allColumns
    );
  }

  async describeTable(
    tableName: string,
    full: boolean = false,
    req?: Request
  ): Promise<TableDescription> {
    const service = await this.createDataverseService(req);
    return this.metadataService.describeTable(service, tableName, full);
  }

  async resolveLogicalName(tableName: string, req?: Request): Promise<string> {
    const service = await this.createDataverseService(req);
    return this.metadataService.resolveLogicalName(service, tableName);
  }

  async getPredefinedQueries(
    tableName: string,
    req?: Request
  ): Promise<import("../../types/dataverse.js").PredefinedQuery[]> {
    const service = await this.createDataverseService(req);
    return this.dataService.getPredefinedQueries(service, tableName);
  }

  async runPredefinedQuery(
    queryIdOrName: string,
    tableName?: string,
    req?: Request
  ): Promise<import("../../types/dataverse.js").QueryResult> {
    const service = await this.createDataverseService(req);
    return this.dataService.runPredefinedQuery(service, queryIdOrName, tableName);
  }

  async runCustomQuery(
    fetchXml: string,
    tableName?: string,
    req?: Request
  ): Promise<import("../../types/dataverse.js").QueryResult> {
    const service = await this.createDataverseService(req);
    return this.dataService.runCustomQuery(service, fetchXml, tableName);
  }
}
