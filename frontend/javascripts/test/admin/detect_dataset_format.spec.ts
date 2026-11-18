import {
  detectDatasetFormat,
  inferDatasetName,
  summarizeSelection,
} from "admin/dataset/upload/detect_dataset_format";
import { describe, expect, it } from "vitest";

describe("detectDatasetFormat", () => {
  it("recognizes an OME-Zarr dataset with its layers", () => {
    expect(
      detectDatasetFormat([
        "/mouse_cortex_L4/.zattrs",
        "/mouse_cortex_L4/.zgroup",
        "/mouse_cortex_L4/color/.zattrs",
        "/mouse_cortex_L4/color/0/.zarray",
        "/mouse_cortex_L4/color/0/0.0.0",
        "/mouse_cortex_L4/segmentation/.zattrs",
        "/mouse_cortex_L4/segmentation/0/.zarray",
      ]),
    ).toEqual({ kind: "native", formatName: "OME-Zarr", layerNames: ["color", "segmentation"] });
  });

  it("does not report magnifications as layers", () => {
    expect(
      detectDatasetFormat(["ds/.zattrs", "ds/.zgroup", "ds/0/.zarray", "ds/1/.zarray"]),
    ).toEqual({ kind: "native", formatName: "OME-Zarr", layerNames: [] });
    expect(
      detectDatasetFormat(["ds/info", "ds/8_8_40/0-64_0-64_0-64", "ds/16_16_40/0-64_0-64_0-64"]),
    ).toEqual({ kind: "native", formatName: "Neuroglancer Precomputed", layerNames: [] });
  });

  it("prefers datasource-properties.json and uses its folder as root", () => {
    expect(
      detectDatasetFormat([
        "/a/ds/datasource-properties.json",
        "/a/ds/color/1/header.wkw",
        "/a/ds/color/2-2-1/header.wkw",
        "/a/ds/segmentation/1/z0/y0/x0.wkw",
      ]),
    ).toEqual({
      kind: "native",
      formatName: "WEBKNOSSOS dataset",
      layerNames: ["color", "segmentation"],
    });
  });

  it("recognizes Zarr 3, N5 and WKW", () => {
    expect(detectDatasetFormat(["ds/zarr.json", "ds/color/zarr.json"])).toMatchObject({
      formatName: "Zarr 3",
      layerNames: ["color"],
    });
    expect(detectDatasetFormat(["ds/attributes.json"])).toMatchObject({ formatName: "N5" });
    expect(detectDatasetFormat(["ds/color/1/header.wkw"])).toMatchObject({ formatName: "WKW" });
  });

  it("does not report WKW bucket folders of a single magnification as layers", () => {
    expect(
      detectDatasetFormat([
        "ds/color/1/header.wkw",
        "ds/color/1/z0/y0/x0.wkw",
        "ds/color/1/z1/y0/x0.wkw",
      ]),
    ).toEqual({ kind: "native", formatName: "WKW", layerNames: [] });
  });

  it("recognizes single- and multi-layer image stacks", () => {
    expect(
      detectDatasetFormat(["slice_0001.tif", "slice_0002.tif", "slice_0003.TIFF", ".DS_Store"]),
    ).toEqual({ kind: "imageStack", formatName: "TIFF", sliceCount: 3, layerCount: 1 });
    expect(
      detectDatasetFormat([
        "/stack/color/1.png",
        "/stack/color/2.png",
        "/stack/segmentation/1.jpg",
        "/stack/segmentation/2.jpg",
      ]),
    ).toEqual({ kind: "imageStack", formatName: "image", sliceCount: 4, layerCount: 2 });
  });

  it("recognizes single-file volumes", () => {
    expect(detectDatasetFormat(["brain.ims"])).toEqual({
      kind: "imageFiles",
      formatName: "IMS",
      fileCount: 1,
    });
    expect(detectDatasetFormat(["volume.tif"])).toEqual({
      kind: "imageFiles",
      formatName: "TIFF",
      fileCount: 1,
    });
    expect(detectDatasetFormat(["a.czi", "b.czi"])).toMatchObject({
      formatName: "CZI",
      fileCount: 2,
    });
  });

  it("returns unknown for unrecognized files", () => {
    expect(detectDatasetFormat(["data.raw", "notes.txt"])).toEqual({ kind: "unknown" });
  });
});

describe("inferDatasetName", () => {
  it("uses the folder name", () => {
    expect(inferDatasetName(["/mouse cortex/a.tif", "/mouse cortex/b.tif"])).toBe("mouse_cortex");
  });

  it("uses the shared prefix of image slices", () => {
    expect(inferDatasetName(["slice_0001.tif", "slice_0002.tif", "slice_0142.tif"])).toBe("slice");
  });

  it("uses the full name of a single file", () => {
    expect(inferDatasetName(["my_dataset.zip"])).toBe("my_dataset");
    expect(inferDatasetName(["dataset_v2.zip"])).toBe("dataset_v2");
    expect(inferDatasetName(["brain_2024.czi"])).toBe("brain_2024");
  });

  it("returns an empty name if no name of the minimum length can be inferred", () => {
    expect(inferDatasetName(["b.tif", "a.tif"])).toBe("");
    expect(inferDatasetName(["/color/1.png", "/color/2.png", "/segmentation/1.png"])).toBe("");
  });
});

describe("summarizeSelection", () => {
  const MiB = 2 ** 20;

  it("summarizes a folder", () => {
    expect(
      summarizeSelection([
        { path: "/ds/a.tif", name: "a.tif", size: MiB },
        { path: "/ds/b.tif", name: "b.tif", size: MiB },
      ]),
    ).toEqual({ kind: "folder", title: "ds/", subtitle: "2 files · 2.0 MiB" });
  });

  it("summarizes loose image files", () => {
    expect(
      summarizeSelection([
        { path: "slice_0002.tif", name: "slice_0002.tif", size: MiB },
        { path: "slice_0001.tif", name: "slice_0001.tif", size: MiB },
        { path: "slice_0003.tif", name: "slice_0003.tif", size: MiB },
      ]),
    ).toEqual({
      kind: "files",
      title: "3 image files",
      subtitle: "slice_0001.tif … slice_0003.tif · 3.0 MiB",
    });
  });

  it("summarizes an archive", () => {
    expect(summarizeSelection([{ path: "ds.zip", name: "ds.zip", size: 2 * MiB }])).toEqual({
      kind: "archive",
      title: "ds.zip",
      subtitle: "ZIP archive · 2.0 MiB",
    });
  });
});
