import type { MeshChunk, MeshLodInfo, MeshSegmentInfo } from "admin/api/mesh";
import { LruMap, LruMapWithSize } from "libs/lru_map";
import sum from "lodash-es/sum";

/*
 * The mesh chunk provider sits between the precomputed mesh loading and the back-end. It caches
 * facts about a mesh file that never change:
 *   - the bytes of a chunk,
 *   - the chunk list of an unmapped segment, or the fact that the segment has no mesh.
 * This makes reloading an agglomerate's mesh after a proofreading merge or split cheap. The new
 * agglomerate consists of segments whose chunks were loaded before, so only the list of its
 * segments has to be asked from the tracingstore, and the chunk bytes are already there.
 * Which segments form an agglomerate is never cached, since every proofreading action changes it.
 * Everything the caches don't know is requested from the back-end, so a cache miss costs a request
 * but never produces a wrong mesh.
 * Only meshes of a layer with an editable mapping, i.e., meshes used for proofreading, are cached.
 * Other meshes are rarely reloaded, so caching them would only cost memory.
 * The functions that load mesh chunks through the provider are in mesh_chunk_provider_accessors.ts.
 */

// The chunks of one segment, indexed by LOD: ChunksPerLod[lodIndex][chunkIndex].
type ChunksPerLod = MeshChunk[][];
// A null value marks a segment without a mesh.
export type ChunkListsBySegmentId = Map<bigint, ChunksPerLod | null>;
// Identifies a chunk within a mesh file, see getChunkDataKey. The byte offset alone is not unique
// in Neuroglancer precomputed mesh files, because they address chunks relative to the shard of the
// segment. Adding the segment id makes it unique, because the segment id selects the shard.
type ChunkDataKey = string;

export type MeshFileLocation = {
  dataStoreUrl: string;
  datasetId: string;
  // The name of the layer in the data store, i.e. the fallback layer of a volume annotation layer.
  layerName: string;
  meshFileName: string;
};

// Upper bounds for the memory of the caches of all mesh files together. Both limits are chosen
// to hold about 5 to 6 large agglomerates. A large agglomerate has about 300k segments and 270k
// chunks with 80 MB of chunk bytes. About 100k of its segments have no mesh, because they are too
// small to show up at the mag the meshes were computed at.
// - Chunk bytes: 6 × 80 MB ≈ 480 MB, so the limit is 512 MB.
// - Chunk lists: each chunk and each segment without a mesh is one entry, so one such
//   agglomerate needs 270k + 100k = 370k entries, and 2M entries hold about 5.4 of them. One
//   MeshChunk object (4 fields, a 3-element position array, a BigInt id) takes roughly 130 bytes,
//   so the full chunk list cache takes about 2M × 130 bytes = 260 MB.
const MAX_CACHED_CHUNK_BYTES = 512 * 1024 ** 2;
const MAX_CACHED_CHUNK_LIST_ENTRIES = 2_000_000;

type MeshFileMetadata = Pick<MeshSegmentInfo, "meshFormat" | "chunkScale"> & {
  lodTransforms: MeshLodInfo["transform"][];
};

/*
 * The caches of one mesh file.
 */
export class MeshFileCache {
  // The LOD transforms and the chunk scale are the same for every segment of a mesh file.
  private metadata: MeshFileMetadata | null = null;
  // A null value marks a segment without a mesh. A segment without chunks still takes an entry in the map; thus returning 1 as size.
  readonly chunkLists = new LruMapWithSize<bigint, ChunksPerLod | null>((chunksPerLod) =>
    Math.max(1, sum(chunksPerLod?.map((chunks) => chunks.length))),
  );
  readonly chunkData = new LruMapWithSize<ChunkDataKey, ArrayBuffer>((buffer) => buffer.byteLength);
  // Called after the cache grew. The memory limits apply to the caches of all mesh files together.
  private readonly evictIfNeeded: () => void;

  constructor(evictIfNeeded: () => void) {
    this.evictIfNeeded = evictIfNeeded;
  }

  canListFromCache(): boolean {
    return this.metadata != null && this.chunkLists.count > 0;
  }

  // Returns the cached chunk lists of the given segments and leaves out the segments the cache
  // doesn't know. Marks the returned entries as recently used, so that they are evicted last.
  getChunkLists(segmentIds: bigint[]): ChunkListsBySegmentId {
    const chunkLists: ChunkListsBySegmentId = new Map();
    for (const segmentId of segmentIds) {
      const chunksPerLod = this.chunkLists.get(segmentId);
      if (chunksPerLod !== undefined) {
        chunkLists.set(segmentId, chunksPerLod);
      }
    }
    return chunkLists;
  }

  // Stores the chunk lists of a listing reply per segment, and the segments of
  // segmentIdsWithoutMesh as having no mesh. A requested segment that is in neither, e.g. because
  // the back-end failed to read it, is not stored, so that it is requested again next time.
  // Returns the stored chunk lists. Use them instead of calling getChunkLists afterwards:
  // this method evicts at its end, which removes some of them already if the reply is large
  // and exceeds the full cache size limit.
  addChunkLists(info: MeshSegmentInfo): ChunkListsBySegmentId {
    if (info.lods.length > 0) {
      this.metadata = {
        meshFormat: info.meshFormat,
        chunkScale: info.chunkScale,
        lodTransforms: info.lods.map((lod) => lod.transform),
      };
    }
    const chunkLists: ChunkListsBySegmentId = new Map(groupChunksBySegmentId(info));
    for (const segmentId of info.segmentIdsWithoutMesh ?? []) {
      chunkLists.set(segmentId, null);
    }
    for (const [segmentId, chunksPerLod] of chunkLists) {
      this.chunkLists.set(segmentId, chunksPerLod);
    }
    this.evictIfNeeded();
    return chunkLists;
  }

  // Builds a listing from the given chunk lists. Returns null if none of them has a chunk.
  toMeshSegmentInfo(chunkLists: Iterable<ChunksPerLod | null>): MeshSegmentInfo | null {
    if (this.metadata == null) {
      return null;
    }
    const chunksPerLodOfSegments = [...chunkLists].filter((chunksPerLod) => chunksPerLod != null);
    return formatToMeshSegmentInfo(this.metadata, chunksPerLodOfSegments);
  }

  getChunkData(chunk: MeshChunk): ArrayBuffer | undefined {
    return this.chunkData.get(getChunkDataKey(chunk));
  }

  // buffers[i] holds the bytes of chunks[i], or undefined if the back-end returned no data for it.
  addChunkData(chunks: MeshChunk[], buffers: Array<ArrayBuffer | undefined>): void {
    chunks.forEach((chunk, index) => {
      const buffer = buffers[index];
      if (buffer != null) {
        this.chunkData.set(getChunkDataKey(chunk), buffer);
      }
    });
    this.evictIfNeeded();
  }
}

function getChunkDataKey(chunk: MeshChunk): ChunkDataKey {
  return `${chunk.unmappedSegmentId}-${chunk.byteOffset}`;
}

function groupChunksBySegmentId(info: MeshSegmentInfo): Map<bigint, ChunksPerLod> {
  const chunksBySegmentId = new Map<bigint, ChunksPerLod>();
  info.lods.forEach((lod, lodIndex) => {
    for (const chunk of lod.chunks) {
      let chunksPerLod = chunksBySegmentId.get(chunk.unmappedSegmentId);
      if (chunksPerLod == null) {
        chunksPerLod = info.lods.map(() => []);
        chunksBySegmentId.set(chunk.unmappedSegmentId, chunksPerLod);
      }
      chunksPerLod[lodIndex].push(chunk);
    }
  });
  return chunksBySegmentId;
}

// Returns null if none of the segments has a chunk.
function formatToMeshSegmentInfo(
  metadata: MeshFileMetadata,
  chunksPerLodOfSegments: ChunksPerLod[],
): MeshSegmentInfo | null {
  const lods = metadata.lodTransforms.map((transform, lodIndex) => ({
    chunks: chunksPerLodOfSegments.flatMap((chunksPerLod) => chunksPerLod[lodIndex] ?? []),
    transform,
  }));
  if (lods.every((lod) => lod.chunks.length === 0)) {
    return null;
  }
  return { meshFormat: metadata.meshFormat, lods, chunkScale: metadata.chunkScale };
}

/*
 * Holds the caches of all mesh files and keeps them within the memory limits.
 */
export class MeshChunkProvider {
  // Ordered by use, so that eviction empties the caches of unused mesh files first.
  // Needs no maxCount: evictIfNeeded enforces the memory limits over all mesh files together,
  // and the cache of a mesh file that was emptied this way takes almost no memory.
  private readonly meshFileCaches = new LruMap<string, MeshFileCache>();

  getCacheForMeshFile(location: MeshFileLocation): MeshFileCache {
    const key = getMeshFileCacheKey(location);
    let cache = this.meshFileCaches.get(key);
    if (cache == null) {
      cache = new MeshFileCache(() => this.evictIfNeeded());
      this.meshFileCaches.set(key, cache);
    }
    return cache;
  }

  /** Clears the caches of all mesh files of the given layer. */
  clearForLayer(layerLocation: Omit<MeshFileLocation, "meshFileName">): void {
    // The mesh file name comes last, so that the keys of all mesh files of a layer share a prefix.
    const keyPrefix = getMeshFileCacheKey({ ...layerLocation, meshFileName: "" });
    for (const key of [...this.meshFileCaches.keys()]) {
      if (key.startsWith(keyPrefix)) {
        this.meshFileCaches.delete(key);
      }
    }
  }

  clear(): void {
    this.meshFileCaches.clear();
  }

  private evictIfNeeded(): void {
    const caches = [...this.meshFileCaches.values()];
    evictAcrossMeshFiles(
      caches.map((cache) => cache.chunkData),
      MAX_CACHED_CHUNK_BYTES,
    );
    evictAcrossMeshFiles(
      caches.map((cache) => cache.chunkLists),
      MAX_CACHED_CHUNK_LIST_ENTRIES,
    );
  }
}

function getMeshFileCacheKey(location: MeshFileLocation): string {
  const { dataStoreUrl, datasetId, layerName, meshFileName } = location;
  return [dataStoreUrl, datasetId, layerName, meshFileName].join("|");
}

// Evicts from the maps of the least recently used mesh files first.
function evictAcrossMeshFiles(
  maps: Array<Pick<LruMapWithSize<unknown, unknown>, "totalSize" | "evictDownTo">>,
  maxTotalSize: number,
): void {
  let totalSize = sum(maps.map((map) => map.totalSize));
  for (const map of maps) {
    if (totalSize <= maxTotalSize) {
      return;
    }
    const excess = totalSize - maxTotalSize;
    totalSize -= map.evictDownTo(Math.max(0, map.totalSize - excess));
  }
}

// Should act as a singleton. There should only be one used MeshChunkProvider.
export const GlobalMeshChunkProvider = new MeshChunkProvider();
