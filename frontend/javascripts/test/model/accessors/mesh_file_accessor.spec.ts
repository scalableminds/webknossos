import type { APIMeshFileInfo } from "types/api_types";
import { sortMeshFilesByPreference } from "viewer/model/accessors/mesh_file_accessor";
import { describe, expect, it } from "vitest";

const legacyFile: APIMeshFileInfo = { name: "legacy", formatVersion: 2 };
const fileForMappingA: APIMeshFileInfo = { name: "a", mappingName: "A", formatVersion: 3 };
const fileForMappingB: APIMeshFileInfo = { name: "b", mappingName: "B", formatVersion: 3 };
const fileWithoutMapping: APIMeshFileInfo = { name: "unmapped", formatVersion: 3 };
const meshFiles = [legacyFile, fileForMappingA, fileForMappingB, fileWithoutMapping];

const getNames = (files: APIMeshFileInfo[]) => files.map((file) => file.name);

describe("sortMeshFilesByPreference", () => {
  it("prefers the mesh file without a mapping if no mapping is active", () => {
    expect(getNames(sortMeshFilesByPreference(meshFiles, null, false))).toEqual([
      "unmapped",
      "a",
      "b",
      "legacy",
    ]);
  });

  it("prefers the mesh file of the active mapping, then the one without a mapping", () => {
    expect(getNames(sortMeshFilesByPreference(meshFiles, "B", false))).toEqual([
      "b",
      "unmapped",
      "a",
      "legacy",
    ]);
  });

  it("prefers the mesh file without a mapping during proofreading", () => {
    // Even if a mesh file was computed for a mapping with the active mapping name.
    expect(getNames(sortMeshFilesByPreference(meshFiles, "A", true))).toEqual([
      "unmapped",
      "a",
      "b",
      "legacy",
    ]);
  });
});
