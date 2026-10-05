import { getSegmentsForAgglomerateFromTracingStore, meshApi } from "admin/rest_api";
import { chunkDynamically } from "libs/utils";
import partition from "lodash-es/partition";
import {
  GlobalMeshChunkProvider,
  type MeshFileCache,
  type MeshFileLocation,
} from "./mesh_chunk_provider";

/*
 * Loads mesh chunk lists and chunk bytes. Answers from the GlobalMeshChunkProvider where it can
 * and requests everything else from the back-end. See mesh_chunk_provider.ts.
 */

type MeshChunk = meshApi.MeshChunk;
type MeshSegmentInfo = meshApi.MeshSegmentInfo;
type ListMeshChunksParams = meshApi.ListMeshChunksParams;

type TracingStoreURLAndTracingId = { tracingStoreUrl: string; tracingId: string };

export type ListMeshChunksParamsWithTracingStoreURL = Omit<
  ListMeshChunksParams,
  "editableMappingTracingId"
> & {
  // tracingId should be the tracing id, not the editable mapping id.
  // If this is set, it is assumed that the request is about an editable mapping.
  editableMapping: TracingStoreURLAndTracingId | null;
};

// If more than this fraction of an agglomerate's segments have no cached chunk list, the normal
// listing of the agglomerate is requested instead of listing the uncached segments by their ids.
// Both are a single request, and listing by ids needs less work on the server and a smaller
// response. But it uploads the ids, and request bodies are not compressed. If most segments are
// uncached, this upload costs more than listing and downloading the cached segments again.
const MAX_UNCACHED_SEGMENT_FRACTION = 0.5;

/*
 * Lists the chunks of segmentId, which is an agglomerate id if a mapping is given. Returns the same
 * as meshApi.getMeshFileChunksForSegment, but answers from the cache where it can.
 */
export async function listMeshChunks(
  params: ListMeshChunksParamsWithTracingStoreURL,
): Promise<MeshSegmentInfo> {
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
  const adaptedParams = { ...params, editableMappingTracingId: params.editableMapping?.tracingId };
  const listing = await meshApi.getMeshFileChunksForSegment(adaptedParams);
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
  params: ListMeshChunksParamsWithTracingStoreURL,
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
}

/*
 * Builds the listing of an agglomerate of the editable mapping from the cached chunk lists of its
 * segments. Returns null if a normal listing should be requested instead.
 */
async function tryToListMeshChunksFromCache(
  cache: MeshFileCache,
  params: ListMeshChunksParamsWithTracingStoreURL,
  editableMapping: TracingStoreURLAndTracingId,
): Promise<MeshSegmentInfo | null> {
  try {
    const segmentIds = await getSegmentsOfEditedAgglomerate(editableMapping, params.segmentId);
    if (segmentIds == null) {
      return null;
    }
    const uncachedSegmentIds = segmentIds.filter((id) => !cache.hasChunkListForSegmentId(id));
    if (uncachedSegmentIds.length > segmentIds.length * MAX_UNCACHED_SEGMENT_FRACTION) {
      // Listing that many segments by their ids costs more than the normal listing.
      return null;
    }
    if (uncachedSegmentIds.length > 0) {
      await addChunkListsOfSegments(cache, params, uncachedSegmentIds);
    }
    // Null if none of the segments has a mesh. The normal listing then reports this as an error.
    return cache.getMeshSegmentInfoOfSegmentIds(segmentIds);
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
 * Cuts the chunks into batches for getMeshChunkData. Cached chunks and chunks that have to be
 * fetched go into separate batches, so that each request contains only missing chunks and has at
 * least minBatchSizeInBytes. Both kinds of batches keep the order of the chunks.
 */
export function batchMeshChunksForLoading(
  location: MeshFileLocation,
  chunks: MeshChunk[],
  minBatchSizeInBytes: number,
): { cachedBatches: MeshChunk[][]; missingBatches: MeshChunk[][] } {
  const cache = GlobalMeshChunkProvider.getCacheForMeshFile(location);
  const [cachedChunks, missingChunks] = partition(
    chunks,
    (chunk) => cache.getChunkData(chunk) != null,
  );
  const batchBySize = (chunksToBatch: MeshChunk[]) =>
    chunkDynamically(chunksToBatch, minBatchSizeInBytes, (chunk) => chunk.byteSize);
  return { cachedBatches: batchBySize(cachedChunks), missingBatches: batchBySize(missingChunks) };
}

function fetchChunkData(
  location: MeshFileLocation,
  segmentIdForRequest: bigint,
  chunks: MeshChunk[],
): Promise<Array<ArrayBuffer | undefined>> {
  return meshApi.getMeshFileChunkData(
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
