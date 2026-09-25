import { getSegmentsForAgglomerateFromTracingStore, meshApi } from "admin/rest_api";
import sum from "lodash-es/sum";
import type { APIMeshFileInfo } from "types/api_types";

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
 */

type MeshChunk = meshApi.MeshChunk;
type MeshSegmentInfo = meshApi.MeshSegmentInfo;
// The chunks of one segment, indexed by LOD.
type ChunksPerLod = MeshChunk[][];

export type MeshFileLocation = {
  dataStoreUrl: string;
  datasetId: string;
  // The name of the layer in the data store, i.e. the fallback layer of a volume annotation layer.
  layerName: string;
  meshFileName: string;
};

// Upper bounds for the memory the caches may use. A cached chunk list entry takes roughly 130
// bytes, so the chunk list cache needs about 130 MB when full. An agglomerate with 300k segments
// has roughly 270k chunks and 80 MB of chunk bytes.
const MAX_CACHED_CHUNK_BYTES = 512 * 1024 ** 2;
const MAX_CACHED_CHUNK_LIST_ENTRIES = 1_000_000;
// When more of an agglomerate's segments are unknown than this share, a normal listing is cheaper
// than listing the unknown segments one by one.
const MAX_UNKNOWN_SEGMENT_SHARE = 0.5;

/*
 * A map that keeps track of the order in which its entries were used and of the total size of its
 * values, so that the least recently used entries can be evicted.
 */
class LruMapWithSize<K, V> {
  private entries = new Map<K, V>();
  private size = 0;
  private readonly getSize: (value: V) => number;

  constructor(getSize: (value: V) => number) {
    this.getSize = getSize;
  }

  get totalSize(): number {
    return this.size;
  }

  get count(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  // Marks the entry as recently used. Returns undefined for unknown keys.
  get(key: K): V | undefined {
    if (!this.entries.has(key)) {
      return undefined;
    }
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.delete(key);
    this.entries.set(key, value);
    this.size += this.getSize(value);
  }

  // Removes the least recently used entries until the total size is at most maxSize. Returns the
  // freed size.
  evictDownTo(maxSize: number): number {
    const sizeBefore = this.size;
    for (const key of this.entries.keys()) {
      if (this.size <= maxSize) {
        break;
      }
      this.delete(key);
    }
    return sizeBefore - this.size;
  }

  private delete(key: K): void {
    if (this.entries.has(key)) {
      this.size -= this.getSize(this.entries.get(key) as V);
      this.entries.delete(key);
    }
  }
}

type MeshFileMetadata = Pick<MeshSegmentInfo, "meshFormat" | "chunkScale"> & {
  lodTransforms: meshApi.MeshLodInfo["transform"][];
};
type CachedChunkData = { byteSize: number; unmappedSegmentId: bigint; buffer: ArrayBuffer };

class MeshFileCache {
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

  canListFromCache(): boolean {
    return this.metadata != null && this.chunkLists.count > 0;
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
  }

  // Builds the listing of the given segments from the cache. Returns null if a segment is unknown
  // or if none of the segments has a mesh.
  assembleListing(segmentIds: bigint[]): MeshSegmentInfo | null {
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
    return mergeIntoListing(this.metadata, chunksPerLodOfSegments);
  }

  getChunkData(chunk: MeshChunk): ArrayBuffer | undefined {
    const cached = this.chunkData.get(chunk.byteOffset);
    const isSameChunk =
      cached?.byteSize === chunk.byteSize && cached.unmappedSegmentId === chunk.unmappedSegmentId;
    return isSameChunk ? cached.buffer : undefined;
  }

  setChunkData(chunk: MeshChunk, buffer: ArrayBuffer): void {
    const { byteSize, unmappedSegmentId } = chunk;
    this.chunkData.set(chunk.byteOffset, { byteSize, unmappedSegmentId, buffer });
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
function mergeIntoListing(
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

// The insertion order is the least-recently-used order, so that eviction empties the caches of
// unused mesh files first.
const meshFileCaches = new Map<string, MeshFileCache>();

function getMeshFileCache(location: MeshFileLocation): MeshFileCache {
  const { dataStoreUrl, datasetId, layerName, meshFileName } = location;
  const key = [dataStoreUrl, datasetId, layerName, meshFileName].join("|");
  const cache = meshFileCaches.get(key) ?? new MeshFileCache();
  meshFileCaches.delete(key);
  meshFileCaches.set(key, cache);
  return cache;
}

function evictIfNeeded(): void {
  const caches = [...meshFileCaches.values()];
  evictAcrossMeshFiles(
    caches.map((cache) => cache.chunkData),
    MAX_CACHED_CHUNK_BYTES,
  );
  evictAcrossMeshFiles(
    caches.map((cache) => cache.chunkLists),
    MAX_CACHED_CHUNK_LIST_ENTRIES,
  );
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

export function clearMeshChunkCaches(): void {
  meshFileCaches.clear();
}

export type ListMeshChunksParams = {
  dataStoreUrl: string;
  datasetId: string;
  // The name of the layer in the data store, i.e. the fallback layer of a volume annotation layer.
  layerName: string;
  meshFile: APIMeshFileInfo;
  segmentId: bigint;
  // See meshApi.getMeshFileChunksForSegment.
  targetMappingName: string | null | undefined;
  // Set if the segmentation layer has an editable mapping.
  editableMapping: { tracingStoreUrl: string; tracingId: string } | null;
  annotationVersion: number | null | undefined;
};

/*
 * Lists the chunks of segmentId, which is an agglomerate id if a mapping is given. Returns the same
 * as meshApi.getMeshFileChunksForSegment, but answers from the cache where it can.
 */
export async function listMeshChunks(params: ListMeshChunksParams): Promise<MeshSegmentInfo> {
  const cache = getMeshFileCache({ ...params, meshFileName: params.meshFile.name });
  if (params.editableMapping != null && cache.canListFromCache()) {
    const listing = await tryToListFromCache(cache, params, params.editableMapping);
    if (listing != null) {
      return listing;
    }
  }

  const listing = await meshApi.getMeshFileChunksForSegment(
    params.dataStoreUrl,
    params.datasetId,
    params.layerName,
    params.meshFile,
    params.segmentId,
    params.targetMappingName,
    params.editableMapping?.tracingId,
    params.annotationVersion,
  );
  cache.addChunkLists(listing);
  evictIfNeeded();
  return listing;
}

/*
 * Builds the listing of an agglomerate of the editable mapping from the cached chunk lists of its
 * segments. Returns null if a normal listing should be requested instead.
 */
async function tryToListFromCache(
  cache: MeshFileCache,
  params: ListMeshChunksParams,
  editableMapping: NonNullable<ListMeshChunksParams["editableMapping"]>,
): Promise<MeshSegmentInfo | null> {
  try {
    const segmentIds = await getSegmentsOfEditedAgglomerate(editableMapping, params.segmentId);
    if (segmentIds == null) {
      return null;
    }
    const unknownSegmentIds = segmentIds.filter((id) => !cache.chunkLists.has(id));
    if (unknownSegmentIds.length > segmentIds.length * MAX_UNKNOWN_SEGMENT_SHARE) {
      return null;
    }
    if (unknownSegmentIds.length > 0) {
      await addChunkListsOfSegments(cache, params, unknownSegmentIds);
    }
    // Null if none of the segments has a mesh. The normal listing then reports this as an error.
    return cache.assembleListing(segmentIds);
  } catch (exception) {
    // E.g., an older data store without the endpoint for listing several segments.
    console.warn(
      `Could not list the mesh chunks of agglomerate ${params.segmentId} from cached segments:`,
      exception,
    );
    return null;
  }
}

/*
 * Returns null for agglomerates that were never edited. Their segments are only listed in the
 * agglomerate file, which the normal listing reads.
 */
async function getSegmentsOfEditedAgglomerate(
  editableMapping: NonNullable<ListMeshChunksParams["editableMapping"]>,
  agglomerateId: bigint,
): Promise<bigint[] | null> {
  // Asked at the newest version on purpose. A refresh should show the newest state anyway, and a
  // read at an older version can return a state from before an edit if the tracingstore applied
  // several update groups at once.
  const { segmentIds, agglomerateIdIsPresent } = await getSegmentsForAgglomerateFromTracingStore(
    editableMapping.tracingStoreUrl,
    editableMapping.tracingId,
    agglomerateId,
  );
  return agglomerateIdIsPresent && segmentIds.length > 0 ? segmentIds : null;
}

async function addChunkListsOfSegments(
  cache: MeshFileCache,
  params: ListMeshChunksParams,
  segmentIds: bigint[],
): Promise<void> {
  const listing = await meshApi.getMeshFileChunksForSegments(
    params.dataStoreUrl,
    params.datasetId,
    params.layerName,
    params.meshFile,
    segmentIds,
  );
  cache.addChunkLists(listing, segmentIds);
  evictIfNeeded();
}

/*
 * Returns the bytes of the given chunks of one mesh file and fetches only those that aren't
 * cached. Returns the same as meshApi.getMeshFileChunkData. An entry is undefined if the back-end
 * returned no data for that chunk.
 */
export async function getMeshChunkData(
  location: MeshFileLocation,
  // The segment id the chunks were listed for. Only relevant for neuroglancer precomputed meshes.
  segmentIdForRequest: bigint,
  chunks: MeshChunk[],
): Promise<Array<ArrayBuffer | undefined>> {
  const cache = getMeshFileCache(location);
  const buffers = chunks.map((chunk) => cache.getChunkData(chunk));
  const missingChunkIndices = buffers.flatMap((buffer, index) => (buffer == null ? [index] : []));
  if (missingChunkIndices.length > 0) {
    const missingChunks = missingChunkIndices.map((index) => chunks[index]);
    const fetchedBuffers = await fetchAndCacheChunkData(
      cache,
      location,
      segmentIdForRequest,
      missingChunks,
    );
    missingChunkIndices.forEach((chunkIndex, fetchedIndex) => {
      buffers[chunkIndex] = fetchedBuffers[fetchedIndex];
    });
  }
  // The draco loader transfers the buffers to its web worker, which empties them on this side.
  // Hand out copies so that the cached buffers stay usable.
  return buffers.map((buffer) => buffer?.slice(0));
}

async function fetchAndCacheChunkData(
  cache: MeshFileCache,
  location: MeshFileLocation,
  segmentIdForRequest: bigint,
  chunks: MeshChunk[],
): Promise<Array<ArrayBuffer | undefined>> {
  const buffers: Array<ArrayBuffer | undefined> = await meshApi.getMeshFileChunkData(
    location.dataStoreUrl,
    location.datasetId,
    location.layerName,
    {
      meshFileName: location.meshFileName,
      requests: chunks.map(({ byteOffset, byteSize }) => ({
        byteOffset,
        byteSize,
        segmentId: segmentIdForRequest,
      })),
    },
  );
  chunks.forEach((chunk, index) => {
    const buffer = buffers[index];
    if (buffer != null) {
      cache.setChunkData(chunk, buffer);
    }
  });
  evictIfNeeded();
  return buffers;
}
