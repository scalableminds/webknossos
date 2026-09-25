import type { MeshChunk, MeshSegmentInfo } from "admin/api/mesh";
import { getSegmentsForAgglomerateFromTracingStore, meshApi } from "admin/rest_api";
import type { APIMeshFileInfo } from "types/api_types";
import {
  clearMeshChunkCaches,
  getMeshChunkData,
  type ListMeshChunksParams,
  listMeshChunks,
} from "viewer/model/sagas/meshes/mesh_chunk_provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("admin/rest_api", () => ({
  getSegmentsForAgglomerateFromTracingStore: vi.fn(),
  meshApi: {
    getMeshFileChunksForSegment: vi.fn(),
    getMeshFileChunksForSegments: vi.fn(),
    getMeshFileChunkData: vi.fn(),
  },
}));

const meshFile: APIMeshFileInfo = { name: "meshfile", mappingName: null, formatVersion: 8 };
const transform: MeshSegmentInfo["lods"][number]["transform"] = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];

function chunk(segmentId: bigint, byteOffset: number): MeshChunk {
  return { position: [0, 0, 0], byteOffset, byteSize: 10, unmappedSegmentId: segmentId };
}

function listing(chunks: MeshChunk[], segmentIdsWithoutMesh: bigint[] = []): MeshSegmentInfo {
  return {
    meshFormat: "draco",
    lods: chunks.length > 0 ? [{ chunks, transform }] : [],
    chunkScale: [1, 1, 1],
    segmentIdsWithoutMesh,
  };
}

function paramsFor(agglomerateId: bigint): ListMeshChunksParams {
  return {
    dataStoreUrl: "http://datastore",
    datasetId: "dataset",
    layerName: "segmentation",
    meshFile,
    segmentId: agglomerateId,
    targetMappingName: "agglomerate_view_70",
    editableMapping: { tracingStoreUrl: "http://tracingstore", tracingId: "tracing" },
    annotationVersion: 5,
  };
}

function listedChunks(info: MeshSegmentInfo): MeshChunk[] {
  return info.lods.flatMap((lod) => lod.chunks);
}

const getSegmentsMock = vi.mocked(getSegmentsForAgglomerateFromTracingStore);
const listingMock = vi.mocked(meshApi.getMeshFileChunksForSegment);
const listingForSegmentsMock = vi.mocked(meshApi.getMeshFileChunksForSegments);
const chunkDataMock = vi.mocked(meshApi.getMeshFileChunkData);

function mockSegmentsOfAgglomerate(segmentIds: bigint[]) {
  getSegmentsMock.mockResolvedValueOnce({ segmentIds, agglomerateIdIsPresent: true });
}

// Agglomerate 1 consists of the segments 10, 11 and 12. Segment 12 has no mesh.
async function loadAgglomerate1() {
  listingMock.mockResolvedValueOnce(listing([chunk(10n, 0), chunk(11n, 10)], [12n]));
  return listMeshChunks(paramsFor(1n));
}

// Agglomerate 2 consists of the segments 20 and 21 and was never edited.
async function loadAgglomerate2() {
  getSegmentsMock.mockResolvedValueOnce({ segmentIds: [], agglomerateIdIsPresent: false });
  listingMock.mockResolvedValueOnce(listing([chunk(20n, 20), chunk(21n, 30)]));
  return listMeshChunks(paramsFor(2n));
}

describe("Mesh chunk provider", () => {
  beforeEach(() => {
    clearMeshChunkCaches();
    vi.resetAllMocks();
  });

  describe("listMeshChunks", () => {
    it("requests the normal listing for the first mesh", async () => {
      const info = await loadAgglomerate1();

      expect(listedChunks(info)).toEqual([chunk(10n, 0), chunk(11n, 10)]);
      expect(listingMock).toHaveBeenCalledTimes(1);
      expect(getSegmentsMock).not.toHaveBeenCalled();
    });

    it("requests the normal listing for an agglomerate that was never edited", async () => {
      await loadAgglomerate1();
      const info = await loadAgglomerate2();

      expect(listedChunks(info)).toEqual([chunk(20n, 20), chunk(21n, 30)]);
      expect(listingMock).toHaveBeenCalledTimes(2);
    });

    it("lists a merged agglomerate from the cache", async () => {
      await loadAgglomerate1();
      await loadAgglomerate2();

      mockSegmentsOfAgglomerate([10n, 11n, 12n, 20n, 21n]);
      const info = await listMeshChunks(paramsFor(1n));

      expect(listedChunks(info)).toEqual([
        chunk(10n, 0),
        chunk(11n, 10),
        chunk(20n, 20),
        chunk(21n, 30),
      ]);
      expect(info.lods[0].transform).toEqual(transform);
      expect(listingMock).toHaveBeenCalledTimes(2);
      expect(listingForSegmentsMock).not.toHaveBeenCalled();
      // The segments are always asked at the newest version.
      expect(getSegmentsMock).toHaveBeenLastCalledWith("http://tracingstore", "tracing", 1n);
    });

    it("lists the agglomerates of a split from the cache", async () => {
      await loadAgglomerate1();

      mockSegmentsOfAgglomerate([10n]);
      const keptAgglomerate = await listMeshChunks(paramsFor(1n));
      mockSegmentsOfAgglomerate([11n, 12n]);
      const splitOffAgglomerate = await listMeshChunks(paramsFor(3n));

      expect(listedChunks(keptAgglomerate)).toEqual([chunk(10n, 0)]);
      expect(listedChunks(splitOffAgglomerate)).toEqual([chunk(11n, 10)]);
      expect(listingMock).toHaveBeenCalledTimes(1);
      expect(listingForSegmentsMock).not.toHaveBeenCalled();
    });

    it("lists unknown segments in one request and remembers segments without a mesh", async () => {
      await loadAgglomerate1();

      mockSegmentsOfAgglomerate([10n, 11n, 12n, 30n, 31n]);
      listingForSegmentsMock.mockResolvedValueOnce(listing([chunk(30n, 40)], [31n]));
      const info = await listMeshChunks(paramsFor(1n));

      expect(listedChunks(info)).toEqual([chunk(10n, 0), chunk(11n, 10), chunk(30n, 40)]);
      expect(listingForSegmentsMock).toHaveBeenCalledTimes(1);
      expect(listingForSegmentsMock.mock.calls[0][4]).toEqual([30n, 31n]);

      // All segments are known now, including that segment 31 has no mesh.
      mockSegmentsOfAgglomerate([31n, 30n, 10n]);
      await listMeshChunks(paramsFor(1n));
      expect(listingForSegmentsMock).toHaveBeenCalledTimes(1);
      expect(listingMock).toHaveBeenCalledTimes(1);
    });

    it("marks requested segments without chunks as having no mesh, even if the back-end doesn't list them", async () => {
      await loadAgglomerate1();

      mockSegmentsOfAgglomerate([10n, 32n]);
      listingForSegmentsMock.mockResolvedValueOnce({
        ...listing([]),
        segmentIdsWithoutMesh: undefined,
      });
      const info = await listMeshChunks(paramsFor(1n));

      expect(listedChunks(info)).toEqual([chunk(10n, 0)]);
      mockSegmentsOfAgglomerate([10n, 32n]);
      await listMeshChunks(paramsFor(1n));
      expect(listingForSegmentsMock).toHaveBeenCalledTimes(1);
    });

    it("requests the normal listing if most segments are unknown", async () => {
      await loadAgglomerate1();

      mockSegmentsOfAgglomerate([10n, 40n, 41n]);
      listingMock.mockResolvedValueOnce(listing([chunk(10n, 0), chunk(40n, 50), chunk(41n, 60)]));
      const info = await listMeshChunks(paramsFor(1n));

      expect(listedChunks(info)).toHaveLength(3);
      expect(listingForSegmentsMock).not.toHaveBeenCalled();
      expect(listingMock).toHaveBeenCalledTimes(2);
    });

    it("requests the normal listing if none of the segments has a mesh", async () => {
      await loadAgglomerate1();

      mockSegmentsOfAgglomerate([12n]);
      listingMock.mockRejectedValueOnce(new Error("zero chunks"));

      await expect(listMeshChunks(paramsFor(5n))).rejects.toThrow("zero chunks");
      expect(listingMock).toHaveBeenCalledTimes(2);
    });

    it("requests the normal listing if the cache can't be used", async () => {
      await loadAgglomerate1();

      // The segments of the agglomerate can't be fetched.
      getSegmentsMock.mockRejectedValueOnce(new Error("network error"));
      listingMock.mockResolvedValueOnce(listing([chunk(10n, 0)]));
      await listMeshChunks(paramsFor(1n));
      // An older data store doesn't know how to list several segments.
      mockSegmentsOfAgglomerate([10n, 11n, 50n]);
      listingForSegmentsMock.mockRejectedValueOnce(new Error("404"));
      listingMock.mockResolvedValueOnce(listing([chunk(10n, 0), chunk(11n, 10), chunk(50n, 70)]));
      const info = await listMeshChunks(paramsFor(1n));

      expect(listedChunks(info)).toHaveLength(3);
      expect(listingMock).toHaveBeenCalledTimes(3);
    });

    it("never uses the segments of the editable mapping without one", async () => {
      await loadAgglomerate1();

      listingMock.mockResolvedValueOnce(listing([chunk(10n, 0)]));
      await listMeshChunks({ ...paramsFor(10n), targetMappingName: null, editableMapping: null });

      expect(getSegmentsMock).not.toHaveBeenCalled();
      expect(listingMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("getMeshChunkData", () => {
    function mockChunkData() {
      chunkDataMock.mockImplementation(async (_dataStoreUrl, _datasetId, _layerName, batch) =>
        batch.requests.map(
          (request) => new Uint8Array(request.byteSize).fill(request.byteOffset % 256).buffer,
        ),
      );
    }

    function getData(chunks: MeshChunk[]) {
      const location = {
        dataStoreUrl: "http://datastore",
        datasetId: "dataset",
        layerName: "segmentation",
        meshFileName: "meshfile",
      };
      return getMeshChunkData(location, 1n, chunks);
    }

    function firstBytes(buffers: Array<ArrayBuffer | undefined>) {
      return buffers.map((buffer) => (buffer != null ? new Uint8Array(buffer)[0] : null));
    }

    it("fetches only chunks that aren't cached", async () => {
      mockChunkData();
      await getData([chunk(10n, 0), chunk(11n, 10)]);
      const buffers = await getData([chunk(11n, 10), chunk(20n, 20), chunk(10n, 0)]);

      expect(firstBytes(buffers)).toEqual([10, 20, 0]);
      expect(chunkDataMock).toHaveBeenCalledTimes(2);
      expect(chunkDataMock.mock.calls[1][3].requests).toEqual([
        { byteOffset: 20, byteSize: 10, segmentId: 1n },
      ]);
    });

    it("does not mix up chunks of different segments at the same byte offset", async () => {
      mockChunkData();
      await getData([chunk(10n, 0)]);
      await getData([chunk(99n, 0)]);

      expect(chunkDataMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the cached bytes when a returned buffer is transferred to a worker", async () => {
      mockChunkData();
      const [buffer] = await getData([chunk(11n, 10)]);
      // Transferring detaches the buffer, as the draco loader does when posting it to its worker.
      structuredClone(buffer, { transfer: [buffer as ArrayBuffer] });
      expect(buffer?.byteLength).toBe(0);

      const [bufferFromCache] = await getData([chunk(11n, 10)]);
      expect(bufferFromCache?.byteLength).toBe(10);
      expect(firstBytes([bufferFromCache])).toEqual([10]);
      expect(chunkDataMock).toHaveBeenCalledTimes(1);
    });
  });
});
