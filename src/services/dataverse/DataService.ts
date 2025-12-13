import {
  SearchResponse,
  PredefinedQuery,
  QueryResult,
} from "../../types/dataverse.js";
import { DataverseWebApiService } from "./DataverseWebApiService.js";
import { MetadataService } from "./MetadataService.js";
import { DataQueryService } from "./DataQueryService.js";
import { DataMutationService } from "./DataMutationService.js";

/**
 * Facade service that delegates to specialized query and mutation services
 */
export class DataService {
  private queryService: DataQueryService;
  private mutationService: DataMutationService;

  constructor(metadataService: MetadataService) {
    this.queryService = new DataQueryService(metadataService);
    this.mutationService = new DataMutationService(metadataService);
  }

  getDeepLinkUrl(
    dataverseUrl: string,
    tableName: string,
    recordId: string
  ): string {
    return this.queryService.getDeepLinkUrl(dataverseUrl, tableName, recordId);
  }

  async search(
    service: DataverseWebApiService,
    searchTerm: string,
    tableFilter?: string | string[],
    top: number = 10
  ): Promise<SearchResponse> {
    return this.queryService.search(service, searchTerm, tableFilter, top);
  }

  async retrieveRecord(
    service: DataverseWebApiService,
    tableName: string,
    recordId: string,
    allColumns: boolean = false
  ): Promise<Record<string, any>> {
    return this.queryService.retrieveRecord(
      service,
      tableName,
      recordId,
      allColumns
    );
  }

  async getPredefinedQueries(
    service: DataverseWebApiService,
    tableName: string
  ): Promise<PredefinedQuery[]> {
    return this.queryService.getPredefinedQueries(service, tableName);
  }

  async runPredefinedQuery(
    service: DataverseWebApiService,
    queryIdOrName: string,
    tableName?: string
  ): Promise<QueryResult> {
    return this.queryService.runPredefinedQuery(
      service,
      queryIdOrName,
      tableName
    );
  }

  async runCustomQuery(
    service: DataverseWebApiService,
    fetchXml: string,
    tableName?: string
  ): Promise<QueryResult> {
    return this.queryService.runCustomQuery(service, fetchXml, tableName);
  }

  async createRecord(
    service: DataverseWebApiService,
    tableName: string,
    data: Record<string, any>
  ): Promise<string> {
    return this.mutationService.createRecord(service, tableName, data);
  }

  async updateRecord(
    service: DataverseWebApiService,
    tableName: string,
    recordId: string,
    data: Record<string, any>
  ): Promise<void> {
    return this.mutationService.updateRecord(
      service,
      tableName,
      recordId,
      data
    );
  }
}
