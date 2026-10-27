import { unwrapOrThrow } from "admin/api/api_result";
import type { ListMeshChunksParams, MeshChunk, MeshSegmentInfo } from "admin/api/mesh";
import { getSegmentsForAgglomerateFromTracingStore, meshApi } from "admin/rest_api";
import { chunkDynamically } from "libs/utils";
import partition from "lodash-es/partition";
import {
  type ChunkListsBySegmentId,
  GlobalMeshChunkProvider,
  type MeshFileCache,
  type MeshFileLocation,
} from "./mesh_chunk_provider";

/*
 * Loads mesh chunk lists and chunk bytes. Answers from the GlobalMeshChunkProvider where it can
 * and requests everything else from the back-end. See mesh_chunk_provider.ts.
 * Each function takes shouldUseMeshChunkCache. If it is false, the function neither reads from nor
 * writes to the cache and requests everything from the back-end.
 */

type TracingStoreURLAndTracingId = { tracingStoreUrl: string; tracingId: string };

export type ListMeshChunksParamsWithTracingStoreURL = Omit<
  ListMeshChunksParams,
  "editableMappingTracingId"
> & {
  // tracingId should be the tracing id, not the editable mapping id.
  // If this is set, it is assumed that the request is about an editable mapping.
  editableMapping: TracingStoreURLAndTracingId | null;
};

/*
 * Lists the chunks of segmentId, which is an agglomerate id if a mapping is given. Returns the value
 * of meshApi.getMeshFileChunksForSegment, but answers from the cache where it can. Throws if the
 * listing fails, so that the caller can notify the user.
 */
export async function listMeshChunks(
  params: ListMeshChunksParamsWithTracingStoreURL,
  shouldUseMeshChunkCache: boolean,
): Promise<MeshSegmentInfo> {
  const adaptedParams = { ...params, editableMappingTracingId: params.editableMapping?.tracingId };
  if (!shouldUseMeshChunkCache) {
    return unwrapOrThrow(await meshApi.getMeshFileChunksForSegment(adaptedParams));
  }
  const cache = GlobalMeshChunkProvider.getCacheForMeshFile({
    ...params,
    meshFileName: params.meshFile.name,
  });
  // The tracingstore lists the unmapped segment ids of an agglomerate. Only a mesh file computed
  // without a mapping stores its meshes under these ids. One computed for a mapping stores them
  // under that mapping's agglomerate ids, which are different ids.
  const isMeshFileKeyedBySegmentIds = params.meshFile.mappingName == null;
  if (params.editableMapping != null && isMeshFileKeyedBySegmentIds && cache.canListFromCache()) {
    const listing = await tryToListMeshChunksFromCache(cache, params, params.editableMapping);
    if (listing != null) {
      return listing;
    }
  }
  const listing = unwrapOrThrow(await meshApi.getMeshFileChunksForSegment(adaptedParams));
  cache.addChunkLists(listing);
  return listing;
}

/*
 * Returns null for agglomerates that were never edited. Their segments are only listed in the
 * agglomerate file, which the normal listing reads.
 */
async function getSegmentsOfEditedAgglomerate(
  editableMapping: TracingStoreURLAndTracingId,
  agglomerateId: bigint,
  annotationVersion: number | undefined,
): Promise<bigint[] | null> {
  const { segmentIds, agglomerateIdIsPresent } = await getSegmentsForAgglomerateFromTracingStore(
    editableMapping.tracingStoreUrl,
    editableMapping.tracingId,
    agglomerateId,
    annotationVersion,
  );
  return agglomerateIdIsPresent && segmentIds.length > 0 ? segmentIds : null;
}

async function fetchChunkListsOfSegments(
  cache: MeshFileCache,
  params: ListMeshChunksParamsWithTracingStoreURL,
  segmentIds: bigint[],
): Promise<ChunkListsBySegmentId> {
  const listingResult = await meshApi.getMeshFileChunksForSegments(
    params.dataStoreUrl,
    params.datasetId,
    params.layerName,
    params.meshFile,
    segmentIds,
  );
  // tryToListMeshChunksFromCache catches the error and falls back to the normal listing.
  const listing = unwrapOrThrow(listingResult);
  return cache.addChunkLists(listing);
}

/*
 * Builds the listing of an agglomerate of the editable mapping from the cached chunk lists of its
 * segments. The chunk lists of uncached segments are requested by their ids in one request, which
 * needs less work on the server and a smaller response than the normal listing of the agglomerate.
 * The cached and the requested chunk lists are combined here instead of being read back from the
 * cache, because storing the requested ones can evict cached ones of a large agglomerate.
 * Segments the back-end failed to list are left out. They are not cached, so the next listing
 * requests them again.
 * Returns null if a normal listing should be requested instead, e.g., because none of the segments
 * is cached.
 */
async function tryToListMeshChunksFromCache(
  cache: MeshFileCache,
  params: ListMeshChunksParamsWithTracingStoreURL,
  editableMapping: TracingStoreURLAndTracingId,
): Promise<MeshSegmentInfo | null> {
  try {
    const segmentIds = await getSegmentsOfEditedAgglomerate(
      editableMapping,
      params.segmentId,
      params.annotationVersion ?? undefined,
    );
    if (segmentIds == null) {
      return null;
    }
    const chunkLists = cache.getChunkLists(segmentIds);
    if (chunkLists.size === 0) {
      return null;
    }
    const uncachedSegmentIds = segmentIds.filter((id) => !chunkLists.has(id));
    if (uncachedSegmentIds.length > 0) {
      const requestedChunkLists = await fetchChunkListsOfSegments(
        cache,
        params,
        uncachedSegmentIds,
      );
      for (const [segmentId, chunksPerLod] of requestedChunkLists) {
        chunkLists.set(segmentId, chunksPerLod);
      }
      warnAboutUnlistedSegments(params.segmentId, uncachedSegmentIds, chunkLists);
    }
    // Null if none of the segments has a mesh, which the normal listing then reports as an error.
    return cache.toMeshSegmentInfo(chunkLists.values());
  } catch (exception) {
    // E.g., an older data store without the endpoint for listing several segments.
    console.warn(
      `Could not list the mesh chunks of agglomerate ${params.segmentId} from cached segments:`,
      exception,
    );
    return null;
  }
}

function warnAboutUnlistedSegments(
  agglomerateId: bigint,
  requestedSegmentIds: bigint[],
  chunkLists: ChunkListsBySegmentId,
): void {
  const unlistedSegmentIds = requestedSegmentIds.filter((id) => !chunkLists.has(id));
  if (unlistedSegmentIds.length > 0) {
    const maxShownSegmentIds = 10;
    const shownSegmentIds = unlistedSegmentIds.slice(0, maxShownSegmentIds).join(", ");
    const ellipsis = unlistedSegmentIds.length > maxShownSegmentIds ? ", ..." : "";
    console.warn(
      `The mesh of agglomerate ${agglomerateId} is incomplete. The back-end failed to list the mesh chunks of ${unlistedSegmentIds.length} segments (${shownSegmentIds}${ellipsis}). They are requested again the next time the mesh is loaded.`,
    );
  }
}

/*
 * Cuts the chunks into batches for getMeshChunkData. Cached chunks and chunks that have to be
 * fetched go into separate batches, so that each request contains only missing chunks and has at
 * least minBatchSizeInBytes. Both kinds of batches keep the order of the chunks.
 */
export function batchMeshChunksForLoading(
  location: MeshFileLocation,
  chunks: MeshChunk[],
  minBatchSizeInBytes: number,
  shouldUseMeshChunkCache: boolean,
): { cachedBatches: MeshChunk[][]; missingBatches: MeshChunk[][] } {
  const batchBySize = (chunksToBatch: MeshChunk[]) =>
    chunkDynamically(chunksToBatch, minBatchSizeInBytes, (chunk) => chunk.byteSize);
  if (!shouldUseMeshChunkCache) {
    return { cachedBatches: [], missingBatches: batchBySize(chunks) };
  }
  const cache = GlobalMeshChunkProvider.getCacheForMeshFile(location);
  const [cachedChunks, missingChunks] = partition(
    chunks,
    (chunk) => cache.getChunkData(chunk) != null,
  );
  return { cachedBatches: batchBySize(cachedChunks), missingBatches: batchBySize(missingChunks) };
}

async function fetchChunkData(
  location: MeshFileLocation,
  segmentIdForRequest: bigint,
  chunks: MeshChunk[],
): Promise<Array<ArrayBuffer | undefined>> {
  const result = await meshApi.getMeshFileChunkData(
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
  return unwrapOrThrow(result);
}

/*
 * Returns the bytes of the given chunks of one mesh file and fetches only those that aren't
 * cached. Returns the value of meshApi.getMeshFileChunkData. An entry is undefined if the back-end
 * returned no data for that chunk. Throws if fetching fails, so that the caller can notify the user.
 */
export async function getMeshChunkData(
  location: MeshFileLocation,
  // The segment id the chunks were listed for. Only relevant for neuroglancer precomputed meshes.
  segmentIdForRequest: bigint,
  chunks: MeshChunk[],
  shouldUseMeshChunkCache: boolean,
): Promise<Array<ArrayBuffer | undefined>> {
  if (!shouldUseMeshChunkCache) {
    return fetchChunkData(location, segmentIdForRequest, chunks);
  }
  const cache = GlobalMeshChunkProvider.getCacheForMeshFile(location);
  const buffers = chunks.map((chunk) => cache.getChunkData(chunk));
  const missingChunkIndices = buffers.flatMap((buffer, index) => (buffer == null ? [index] : []));
  if (missingChunkIndices.length > 0) {
    const missingChunks = missingChunkIndices.map((index) => chunks[index]);
    const fetchedBuffers = await fetchChunkData(location, segmentIdForRequest, missingChunks);
    cache.addChunkData(missingChunks, fetchedBuffers);
    missingChunkIndices.forEach((chunkIndex, fetchedIndex) => {
      buffers[chunkIndex] = fetchedBuffers[fetchedIndex];
    });
  }
  // The draco loader transfers the buffers to its web worker, which empties them on this side.
  // Hand out copies so that the cached buffers stay usable.
  return buffers.map((buffer) => buffer?.slice(0));
}
