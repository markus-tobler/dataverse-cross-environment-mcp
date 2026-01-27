/**
 * Unit tests for TOON formatting and pagination utilities.
 */

import {
  formatOutput,
  paginateResults,
  encodeCursor,
  decodeCursor,
  type OutputFormat,
} from "../toonFormatter.js";

describe("toonFormatter utilities", () => {
  describe("formatOutput", () => {
    it("should format data as JSON by default", () => {
      const data = [{ id: 1, name: "Test" }];
      const result = formatOutput(data);

      expect(result).toBe(JSON.stringify(data, null, 2));
    });

    it("should format data as JSON when format is 'json'", () => {
      const data = [{ id: 1, name: "Test" }];
      const result = formatOutput(data, "json");

      expect(result).toBe(JSON.stringify(data, null, 2));
    });

    it("should format data as TOON when format is 'toon'", () => {
      const data = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      const result = formatOutput(data, "toon");

      // TOON format should be compact - verify it's different from JSON
      const jsonResult = JSON.stringify(data, null, 2);
      expect(result).not.toBe(jsonResult);
      // TOON should be more compact
      expect(result.length).toBeLessThan(jsonResult.length);
    });

    it("should handle empty arrays", () => {
      const data: any[] = [];
      const jsonResult = formatOutput(data, "json");
      const toonResult = formatOutput(data, "toon");

      expect(jsonResult).toBe("[]");
      // TOON should handle empty arrays gracefully
      expect(toonResult).toBeDefined();
    });

    it("should handle nested objects", () => {
      const data = {
        records: [{ id: 1, name: "Test", attributes: { type: "account" } }],
      };
      const jsonResult = formatOutput(data, "json");
      const toonResult = formatOutput(data, "toon");

      expect(jsonResult).toContain('"records"');
      expect(toonResult).toBeDefined();
    });
  });

  describe("encodeCursor and decodeCursor", () => {
    it("should encode and decode cursor correctly", () => {
      const cursorData = {
        offset: 50,
        pageSize: 25,
        table: "account",
        queryId: "query-123",
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });

    it("should return null for invalid cursor", () => {
      const result = decodeCursor("invalid-base64-cursor");
      expect(result).toBeNull();
    });

    it("should return null for cursor missing required fields", () => {
      // Create a valid base64 string but with missing fields
      const invalidData = Buffer.from(JSON.stringify({ foo: "bar" })).toString(
        "base64",
      );
      const result = decodeCursor(invalidData);

      expect(result).toBeNull();
    });

    it("should handle cursor with only required fields", () => {
      const cursorData = {
        offset: 100,
        pageSize: 50,
      };

      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(cursorData);
    });
  });

  describe("paginateResults", () => {
    const sampleItems = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
    }));

    it("should return first page with default page size", () => {
      const result = paginateResults(sampleItems);

      expect(result.items).toHaveLength(50);
      expect(result.items[0].id).toBe(1);
      expect(result.items[49].id).toBe(50);
      expect(result.pagination.pageSize).toBe(50);
      expect(result.pagination.returnedCount).toBe(50);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).not.toBeNull();
    });

    it("should use custom page size", () => {
      const result = paginateResults(sampleItems, 25);

      expect(result.items).toHaveLength(25);
      expect(result.pagination.pageSize).toBe(25);
      expect(result.pagination.returnedCount).toBe(25);
      expect(result.pagination.hasMore).toBe(true);
    });

    it("should handle second page via cursor", () => {
      const firstPage = paginateResults(sampleItems, 30);
      expect(firstPage.pagination.nextCursor).not.toBeNull();

      const secondPage = paginateResults(
        sampleItems,
        30,
        firstPage.pagination.nextCursor!,
      );

      expect(secondPage.items).toHaveLength(30);
      expect(secondPage.items[0].id).toBe(31);
      expect(secondPage.pagination.hasMore).toBe(true);
    });

    it("should return last page correctly", () => {
      // Get to the last page
      const pageSize = 30;
      let cursor: string | undefined;
      let result;

      // Iterate through pages
      do {
        result = paginateResults(sampleItems, pageSize, cursor);
        cursor = result.pagination.nextCursor ?? undefined;
      } while (result.pagination.hasMore);

      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextCursor).toBeNull();
      // Last page should have remaining items (100 % 30 = 10)
      expect(result.items).toHaveLength(10);
    });

    it("should clamp page size to maximum of 500", () => {
      const result = paginateResults(sampleItems, 1000);

      // Should be clamped to 100 (the array length in this case, since it's less than 500)
      expect(result.items.length).toBeLessThanOrEqual(100);
      expect(result.pagination.pageSize).toBeLessThanOrEqual(500);
    });

    it("should clamp page size to minimum of 1", () => {
      const result = paginateResults(sampleItems, 0);

      expect(result.items).toHaveLength(1);
      expect(result.pagination.pageSize).toBe(1);
    });

    it("should handle empty array", () => {
      const result = paginateResults([]);

      expect(result.items).toHaveLength(0);
      expect(result.pagination.returnedCount).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextCursor).toBeNull();
    });

    it("should include context in cursor", () => {
      const result = paginateResults(sampleItems, 25, undefined, {
        table: "account",
        queryId: "my-query",
      });

      expect(result.pagination.nextCursor).not.toBeNull();
      const decodedCursor = decodeCursor(result.pagination.nextCursor!);

      expect(decodedCursor?.table).toBe("account");
      expect(decodedCursor?.queryId).toBe("my-query");
    });

    it("should report total count when available", () => {
      const result = paginateResults(sampleItems, 25);

      expect(result.pagination.totalCount).toBe(100);
    });

    it("should use page size from cursor for consistency", () => {
      // First request with page size 20
      const firstPage = paginateResults(sampleItems, 20);

      // Second request - cursor should enforce original page size even if different value passed
      const secondPage = paginateResults(
        sampleItems,
        50, // Different page size
        firstPage.pagination.nextCursor!,
      );

      // Should use page size from cursor (20) not the passed value (50)
      expect(secondPage.items).toHaveLength(20);
      expect(secondPage.pagination.pageSize).toBe(20);
    });
  });
});
