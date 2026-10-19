import { toAPIMetadataEntry } from "viewer/view/right_border_tabs/metadata_table";
import { describe, expect, it } from "vitest";

describe("toAPIMetadataEntry", () => {
  it("should keep falsy number and string values", () => {
    expect(toAPIMetadataEntry({ key: "n", numberValue: 0, stringListValue: [] })).toEqual({
      key: "n",
      type: "number",
      value: 0,
    });
    expect(toAPIMetadataEntry({ key: "s", stringValue: "", stringListValue: [] })).toEqual({
      key: "s",
      type: "string",
      value: "",
    });
  });

  it("should not convert boolean entries to string arrays", () => {
    expect(toAPIMetadataEntry({ key: "b", boolValue: false, stringListValue: [] })).toEqual({
      key: "b",
      type: "string",
      value: "false",
    });
  });

  it("should map string list entries", () => {
    expect(toAPIMetadataEntry({ key: "l", stringListValue: ["a"] })).toEqual({
      key: "l",
      type: "string[]",
      value: ["a"],
    });
    expect(toAPIMetadataEntry({ key: "l" })).toEqual({ key: "l", type: "string[]", value: [] });
  });
});
