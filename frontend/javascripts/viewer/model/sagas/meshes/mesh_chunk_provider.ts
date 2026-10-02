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
 * The functions that load mesh chunks through the provider are in mesh_chunk_provider_accessors.ts.
 */

// The chunks of one segment, indexed by LOD: ChunksPerLod[lodIndex][chunkIndex].
type ChunksPerLod = MeshChunk[][];

export type MeshFileLocation = {
  dataStoreUrl: string;
  datasetId: string;
  // The name of the layer in the data store, i.e. the fallback layer of a volume annotation layer.
  layerName: string;
  meshFileName: string;
};

// Upper bounds for the memory of the caches of all mesh files together, enough for about 5 to 6
// large agglomerates. An agglomerate with 300k segments has roughly 270k chunks and 80 MB of chunk
// bytes. About 100k of its segments have no mesh, because they are too small to show up at the mag
// the meshes were computed at. Each chunk and each segment without a mesh takes one chunk list
// entry of roughly 130 bytes, so the chunk list cache needs about 260 MB when full.
const MAX_CACHED_CHUNK_BYTES = 512 * 1024 ** 2;
const MAX_CACHED_CHUNK_LIST_ENTRIES = 2_000_000;

type MeshFileMetadata = Pick<MeshSegmentInfo, "meshFormat" | "chunkScale"> & {
  lodTransforms: MeshLodInfo["transform"][];
};
type CachedChunkData = { byteSize: number; unmappedSegmentId: bigint; buffer: ArrayBuffer };

/*
 * The caches of one mesh file.
 */
export class MeshFileCache {
  // The LOD transforms and the chunk scale are the same for every segment of a mesh file.
  private metadata: MeshFileMetadata | null = null;
  // A null value marks a segment without a mesh. A segment without chunks still takes an entry.
  readonly chunkLists = new LruMapWithSize<bigint, ChunksPerLod | null>((chunksPerLod) =>
    Math.max(1, sum(chunksPerLod?.map((chunks) => chunks.length))),
  );
  // Keyed by byte offset, which is unique within zarr and hdf5 mesh files. Neuroglancer
  // precomputed mesh files address chunks relative to a shard. There, the entry must also match the
  // owning segment id, which selects the shard when no mapping is involved.
  readonly chunkData = new LruMapWithSize<number, CachedChunkData>(
    (entry) => entry.buffer.byteLength,
  );
  // Called after the cache grew. The memory limits apply to the caches of all mesh files together.
  private readonly evictIfNeeded: () => void;

  constructor(evictIfNeeded: () => void) {
    this.evictIfNeeded = evictIfNeeded;
  }

  canListFromCache(): boolean {
    return this.metadata != null && this.chunkLists.count > 0;
  }

  /** Returns whether the MeshFileCache has an entry for segmentId.
   * Note that the list might be empty due to the segment not having a chunk.
   */
  hasChunkListForSegmentId(segmentId: bigint): boolean {
    return this.chunkLists.has(segmentId);
  }

  // Stores the chunk lists of a listing reply per segment. Segments of requestedSegmentIds without
  // any chunk in the reply are stored as having no mesh.
  addChunkLists(info: MeshSegmentInfo, requestedSegmentIds: Iterable<bigint> = []): void {
    if (info.lods.length > 0) {
      this.metadata = {
        meshFormat: info.meshFormat,
        chunkScale: info.chunkScale,
        lodTransforms: info.lods.map((lod) => lod.transform),
      };
    }
    const chunksBySegmentId = groupChunksBySegmentId(info);
    for (const [segmentId, chunksPerLod] of chunksBySegmentId) {
      this.chunkLists.set(segmentId, chunksPerLod);
    }
    for (const segmentId of [...(info.segmentIdsWithoutMesh ?? []), ...requestedSegmentIds]) {
      if (!chunksBySegmentId.has(segmentId)) {
        this.chunkLists.set(segmentId, null);
      }
    }
    this.evictIfNeeded();
  }

  // Builds the listing of the given segments from the cache. Returns null if a segment is unknown
  // or if none of the segments has a mesh.
  getMeshSegmentInfoOfSegmentIds(segmentIds: bigint[]): MeshSegmentInfo | null {
    if (this.metadata == null) {
      return null;
    }
    const chunksPerLodOfSegments: ChunksPerLod[] = [];
    for (const segmentId of segmentIds) {
      const chunksPerLod = this.chunkLists.get(segmentId);
      if (chunksPerLod === undefined) {
        return null;
      }
      if (chunksPerLod != null) {
        chunksPerLodOfSegments.push(chunksPerLod);
      }
    }
    return formatToMeshSegmentInfo(this.metadata, chunksPerLodOfSegments);
  }

  getChunkData(chunk: MeshChunk): ArrayBuffer | undefined {
    const cached = this.chunkData.get(chunk.byteOffset);
    const isSameChunk =
      cached?.byteSize === chunk.byteSize && cached.unmappedSegmentId === chunk.unmappedSegmentId;
    return isSameChunk ? cached.buffer : undefined;
  }

  // buffers[i] holds the bytes of chunks[i], or undefined if the back-end returned no data for it.
  addChunkData(chunks: MeshChunk[], buffers: Array<ArrayBuffer | undefined>): void {
    chunks.forEach((chunk, index) => {
      const buffer = buffers[index];
      if (buffer != null) {
        const { byteSize, unmappedSegmentId } = chunk;
        this.chunkData.set(chunk.byteOffset, { byteSize, unmappedSegmentId, buffer });
      }
    });
    this.evictIfNeeded();
  }
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
  private readonly meshFileCaches = new LruMap<string, MeshFileCache>();

  getCacheForMeshFile(location: MeshFileLocation): MeshFileCache {
    const { dataStoreUrl, datasetId, layerName, meshFileName } = location;
    const key = [dataStoreUrl, datasetId, layerName, meshFileName].join("|");
    let cache = this.meshFileCaches.get(key);
    if (cache == null) {
      cache = new MeshFileCache(() => this.evictIfNeeded());
      this.meshFileCaches.set(key, cache);
    }
    return cache;
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
