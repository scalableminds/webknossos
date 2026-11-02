import {
  classifyExploreReport,
  detectFormat,
  detectStorage,
  getDatasetNameFromUrl,
  mergeNewLayers,
} from "admin/dataset/remote/remote_url_utils";
import type { DataLayer, DatasourceConfiguration } from "types/schemas/datasource.types";
import { UnitLong } from "viewer/constants";
import { describe, expect, it } from "vitest";

describe("detectStorage", () => {
  it("detects the storage from the protocol", () => {
    expect(detectStorage("s3://bucket/data.zarr")).toBe("s3");
    expect(detectStorage("gs://bucket/data.zarr")).toBe("gs");
    expect(detectStorage("https://example.org/data.zarr")).toBe("https");
    expect(detectStorage("http://example.org/data.zarr")).toBe("https");
    expect(detectStorage("  S3://bucket/data.zarr")).toBe("s3");
  });

  it("strips a Neuroglancer scheme first", () => {
    expect(detectStorage("zarr3://s3://bucket/data")).toBe("s3");
    expect(detectStorage("precomputed://gs://bucket/data")).toBe("gs");
  });

  it("returns null without a known protocol", () => {
    expect(detectStorage("bucket/data.zarr")).toBeNull();
    expect(detectStorage("")).toBeNull();
  });
});

describe("detectFormat", () => {
  it("detects the format from the path or scheme", () => {
    expect(detectFormat("s3://bucket/cortex_l4.ome.zarr")).toBe("OME-Zarr");
    expect(detectFormat("s3://bucket/cortex_l4.zarr/")).toBe("Zarr");
    expect(detectFormat("zarr://https://example.org/data")).toBe("Zarr");
    expect(detectFormat("zarr3://https://example.org/data")).toBe("Zarr3");
    expect(detectFormat("https://example.org/data.n5")).toBe("N5");
    expect(detectFormat("precomputed://gs://bucket/data")).toBe("Neuroglancer Precomputed");
    expect(detectFormat("https://example.org/data")).toBeNull();
  });
});

describe("getDatasetNameFromUrl", () => {
  it("uses the last path element without the format extension", () => {
    expect(getDatasetNameFromUrl("s3://lab-bucket/em/cortex_l4.ome.zarr")).toBe("cortex_l4");
    expect(getDatasetNameFromUrl("https://example.org/data/sample.zarr/")).toBe("sample");
    expect(getDatasetNameFromUrl("gs://bucket/volume.n5")).toBe("volume");
    expect(getDatasetNameFromUrl("")).toBe("");
  });
});

describe("classifyExploreReport", () => {
  it("maps explore reports to error kinds", () => {
    expect(classifyExploreReport("Tried OME-Zarr: 403 Forbidden on .zattrs")).toBe("access");
    expect(classifyExploreReport("Tried Zarr: 404 Not Found")).toBe("notFound");
    expect(classifyExploreReport("Could not find any supported data")).toBe("noData");
  });
});

describe("mergeNewLayers", () => {
  const layer = (name: string) => ({ name, category: "color" }) as DataLayer;
  const dataSource = (...names: string[]): DatasourceConfiguration => ({
    id: { name: "ds", team: "" },
    dataLayers: names.map(layer),
    scale: { factor: [1, 1, 1], unit: UnitLong.nm },
  });

  it("returns the new datasource if there is none yet", () => {
    const newDataSource = dataSource("em");
    expect(mergeNewLayers(null, newDataSource)).toBe(newDataSource);
  });

  it("appends layers and renames those whose name is taken", () => {
    const merged = mergeNewLayers(
      dataSource("em", "segmentation", "segmentation_2"),
      dataSource("segmentation", "mito"),
    );
    expect(merged.dataLayers.map(({ name }) => name)).toEqual([
      "em",
      "segmentation",
      "segmentation_2",
      "segmentation_3",
      "mito",
    ]);
  });
});
