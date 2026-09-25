import type { meshApi } from "admin/rest_api";
import { V3 } from "libs/mjs";
import sortBy from "lodash-es/sortBy";
import sortedIndex from "lodash-es/sortedIndex";
import sortedIndexOf from "lodash-es/sortedIndexOf";
import { BufferAttribute, BufferGeometry } from "three";
import type { Vector3 } from "viewer/constants";

export type BufferGeometryWithInfo = BufferGeometry & {
  vertexSegmentMapping?: VertexSegmentMapping;
};

export type UnmergedBufferGeometryWithInfo = BufferGeometry & {
  unmappedSegmentId: bigint;
  vertexSegmentMapping?: VertexSegmentMapping;
};

export class VertexSegmentMapping {
  /*
   * This class creates a mapping between vertices of multiple buffer geometries
   * and the corresponding segment id of each buffer geometry.
   *
   * Each geometry has an unmapped segment id (multiple ones can have
   * the same segment id) and various vertices.
   * All (sorted) geometries are concatenated and then indices are built
   * to allow for fast queries via binary search.
   * E.g., one query allows to go from a vertex index ("position", named
   * like the BufferAttribute "position") to
   * the unmapped segment id of the geometry that belongs to the vertex.
   * Similarly, one can obtain the range that covers all vertices
   * that belong to a certain unmapped segment id.
   * Other queries allow a similar mapping between vertex index ("position")
   * and unmapped segment id.
   */
  cumulativeStartPosition: number[];
  unmappedSegmentIds: bigint[];
  constructor(sortedBufferGeometries: UnmergedBufferGeometryWithInfo[]) {
    let cumsum = 0;
    this.cumulativeStartPosition = [];
    this.unmappedSegmentIds = [];

    for (const bufferGeometry of sortedBufferGeometries) {
      const isNewSegmentId =
        this.unmappedSegmentIds.length === 0 ||
        bufferGeometry.unmappedSegmentId !== this.unmappedSegmentIds.at(-1);

      if (isNewSegmentId) {
        this.unmappedSegmentIds.push(bufferGeometry.unmappedSegmentId);
        this.cumulativeStartPosition.push(cumsum);
      }
      cumsum += bufferGeometry.attributes.position.count;
    }
    // Add sentinel value at the end - this implements an offset table pattern
    // where the last entry indicates the total size of all vertices
    this.cumulativeStartPosition.push(cumsum);
  }

  getUnmappedSegmentIdForPosition(position: number) {
    const index = sortedIndex(this.cumulativeStartPosition, position) - 1;
    if (index >= this.unmappedSegmentIds.length) {
      throw new Error(`Could not look up id for position=${position} in VertexSegmentMapping.`);
    }
    return this.unmappedSegmentIds[index];
  }

  getRangeForPosition(position: number): [number, number] {
    const index = sortedIndex(this.cumulativeStartPosition, position) - 1;
    if (index + 1 >= this.cumulativeStartPosition.length) {
      throw new Error(`Could not look up range for position=${position} in VertexSegmentMapping.`);
    }
    return [this.cumulativeStartPosition[index], this.cumulativeStartPosition[index + 1]];
  }

  getRangeForUnmappedSegmentId(segmentId: bigint): [number, number] | null {
    const index = sortedIndexOf(this.unmappedSegmentIds, segmentId);
    if (index === -1) {
      return null;
    }
    return [this.cumulativeStartPosition[index], this.cumulativeStartPosition[index + 1]];
  }

  containsSegmentId(segmentId: bigint): boolean {
    return sortedIndexOf(this.unmappedSegmentIds, segmentId) !== -1;
  }

  /**
   * Builds a VertexSegmentMapping directly from (segmentId, vertexCount) pairs, without going
   * through the normal constructor. Used when a sub-geometry is sliced out of an already-merged geometry.
   */
  static fromSegmentIdSortedCountList(
    entries: Array<{ segmentId: bigint; count: number }>,
  ): VertexSegmentMapping {
    const mapping = new VertexSegmentMapping([]);
    mapping.unmappedSegmentIds = entries.map((entry) => entry.segmentId);
    let cumsum = 0;
    mapping.cumulativeStartPosition = entries.map((entry) => {
      const start = cumsum;
      cumsum += entry.count;
      return start;
    });
    mapping.cumulativeStartPosition.push(cumsum);
    return mapping;
  }
}

// A copyable slice of vertices from one source geometry - [start, end) is a range of vertex
// indices (not raw typed-array offsets). copyAttributesForRanges/copyAndRemapIndexForRanges below
// take a list of these so several different source geometries can be merged into one target
// geometry in a single pass (see mergeGeometriesByUnmappedSegmentId), not just ranges of one.
type GeometryRange = { geometry: BufferGeometry; start: number; end: number };

/*
 * Copies every attribute (position, normal, ...) except color from each range's source geometry
 * into targetGeometry, concatenated in the given order. Assumes every source shares the same
 * attribute names and typed-array types, which holds for all geometries this module deals with
 * (they're all produced by the same precomputed-mesh pipeline).
 */
function copyAttributesForRanges(
  targetGeometry: BufferGeometry,
  ranges: GeometryRange[],
  totalVertexCount: number,
): void {
  if (ranges.length === 0) return;
  const attributeNamesToCopy = Object.keys(ranges[0].geometry.attributes).filter(
    (name) => name !== "color",
  );
  for (const attributeName of attributeNamesToCopy) {
    const templateAttribute = ranges[0].geometry.getAttribute(attributeName);
    const itemSize = templateAttribute.itemSize;
    // Create a new array of the same type as the source attribute (Float32Array | Uint16Array |
    // Int16Array | ...), sized for just the copied vertices.
    const newArray = new (
      templateAttribute.array.constructor as new (
        length: number,
      ) => typeof templateAttribute.array
    )(totalVertexCount * itemSize) as unknown as {
      set: (source: typeof templateAttribute.array, offset: number) => void;
    };
    let writeOffset = 0;
    for (const { geometry, start, end } of ranges) {
      const oldAttribute = geometry.getAttribute(attributeName);
      const oldArray = oldAttribute.array as unknown as {
        subarray: (start: number, end: number) => typeof oldAttribute.array;
      };
      newArray.set(oldArray.subarray(start * itemSize, end * itemSize), writeOffset);
      writeOffset += (end - start) * itemSize;
    }
    // newArray's concrete TypedArray subtype is only known at runtime (it mirrors whatever type
    // the source attribute happened to use).
    targetGeometry.setAttribute(
      attributeName,
      new BufferAttribute(newArray as any, itemSize, templateAttribute.normalized),
    );
  }
}

/*
 * Copies each range's source geometry's index (triangle) buffer into targetGeometry, keeping only
 * triangles whose vertices all fall within a kept range, and rewriting ("remapping") their vertex
 * indices to point into the *new*, compacted attribute arrays that copyAttributesForRanges
 * produced. One source can contribute several (possibly non-adjacent, in the merged output)
 * ranges, so the old-to-new vertex mapping is built per source before its index buffer is scanned.
 */
function copyAndRemapIndexForRanges(
  targetGeometry: BufferGeometry,
  ranges: GeometryRange[],
  totalVertexCount: number,
): void {
  if (ranges.length === 0 || ranges[0].geometry.index == null) return;

  const oldToNewVertexIndexBySource = new Map<BufferGeometry, Map<number, number>>();
  let newVertexIndex = 0;
  for (const { geometry, start, end } of ranges) {
    let oldToNewVertexIndex = oldToNewVertexIndexBySource.get(geometry);
    if (oldToNewVertexIndex == null) {
      oldToNewVertexIndex = new Map();
      oldToNewVertexIndexBySource.set(geometry, oldToNewVertexIndex);
    }
    for (let oldVertexIndex = start; oldVertexIndex < end; oldVertexIndex++) {
      oldToNewVertexIndex.set(oldVertexIndex, newVertexIndex);
      newVertexIndex++;
    }
  }

  const newIndices: number[] = [];
  for (const [sourceGeometry, oldToNewVertexIndex] of oldToNewVertexIndexBySource) {
    if (sourceGeometry.index == null) continue;
    const oldIndices = sourceGeometry.index.array;
    for (let i = 0; i < oldIndices.length; i += 3) {
      const a = oldToNewVertexIndex.get(oldIndices[i]);
      const b = oldToNewVertexIndex.get(oldIndices[i + 1]);
      const c = oldToNewVertexIndex.get(oldIndices[i + 2]);
      if (a != null && b != null && c != null) {
        newIndices.push(a, b, c);
      }
    }
  }
  const IndexArrayCtor = totalVertexCount > 65535 ? Uint32Array : Uint16Array;
  // setIndex only auto-wraps a plain Array, storing a typed array as-is. That leaves
  // geometry.index without the usage/onUploadCallback of a real BufferAttribute, which crashes the
  // renderer on upload. So wrap it explicitly.
  targetGeometry.setIndex(new BufferAttribute(new IndexArrayCtor(newIndices), 1));
}

/**
 * Slices a subset of unmapped segment/supervoxel ids out of a merged mesh geometry representing
 * an agglomerate. This has to carry a vertexSegmentMapping for this.
 * The function returns a new, independent BufferGeometry containing only the
 * vertices (and, if indexed, only the triangles) belonging to `segmentIdsToKeep`. Returns null if the
 * geometry has no vertexSegmentMapping.
 *
 * Used to update a mesh locally after a split proofreading operation to save a network round-trip.
 */
export function extractSubGeometry(
  geometry: BufferGeometryWithInfo,
  segmentIdsToKeep: Set<bigint>,
): BufferGeometryWithInfo | null {
  const vertexSegmentMapping = geometry.vertexSegmentMapping;
  if (vertexSegmentMapping == null) return null;

  const { unmappedSegmentIds, cumulativeStartPosition } = vertexSegmentMapping;
  // Vertex-attribute ranges to keep, in the same (sorted-by-unmapped-segment-id) order as they
  // appear in the source geometry.
  const rangesToCopy: GeometryRange[] = [];
  const rangeLengthAndIdsList: Array<{ segmentId: bigint; count: number }> = [];
  for (let i = 0; i < unmappedSegmentIds.length; i++) {
    const segmentId = unmappedSegmentIds[i];
    if (segmentIdsToKeep.has(segmentId)) {
      const start = cumulativeStartPosition[i];
      const end = cumulativeStartPosition[i + 1];
      rangesToCopy.push({ geometry, start, end });
      rangeLengthAndIdsList.push({ segmentId, count: end - start });
    }
  }
  if (rangesToCopy.length === 0) return null;

  const totalVertexCount = rangeLengthAndIdsList.reduce((sum, entry) => sum + entry.count, 0);
  const newGeometry = new BufferGeometry() as BufferGeometryWithInfo;

  copyAttributesForRanges(newGeometry, rangesToCopy, totalVertexCount);
  copyAndRemapIndexForRanges(newGeometry, rangesToCopy, totalVertexCount);

  newGeometry.vertexSegmentMapping =
    VertexSegmentMapping.fromSegmentIdSortedCountList(rangeLengthAndIdsList);
  return newGeometry;
}

/**
 * Merges several already-tagged (vertexSegmentMapping-carrying) geometries into one, with a fresh
 * VertexSegmentMapping sorted globally by unmapped/supervoxel id. Unlike three.js's mergeGeometries
 * + `new VertexSegmentMapping(...)`, which needs every input to hold exactly one unmapped id, this
 * also handles inputs bundling several ids, such as the sibling mesh nodes a local proofreading
 * merge leaves behind (see SegmentMeshController.mergeMeshSiblingsIntoOneGeometry).
 * Returns null if none of the inputs have any ids.
 */
export function mergeGeometriesByUnmappedSegmentId(
  geometries: BufferGeometryWithInfo[],
): BufferGeometryWithInfo | null {
  const entries: Array<{ segmentId: bigint; range: GeometryRange }> = [];
  for (const geometry of geometries) {
    const vertexSegmentMapping = geometry.vertexSegmentMapping;
    if (vertexSegmentMapping == null) continue;
    const { unmappedSegmentIds, cumulativeStartPosition } = vertexSegmentMapping;
    for (let i = 0; i < unmappedSegmentIds.length; i++) {
      entries.push({
        segmentId: unmappedSegmentIds[i],
        range: {
          geometry,
          start: cumulativeStartPosition[i],
          end: cumulativeStartPosition[i + 1],
        },
      });
    }
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0));

  const ranges = entries.map((entry) => entry.range);
  const rangeLengthAndIdsList = entries.map((entry) => ({
    segmentId: entry.segmentId,
    count: entry.range.end - entry.range.start,
  }));
  const totalVertexCount = rangeLengthAndIdsList.reduce((sum, entry) => sum + entry.count, 0);

  const mergedGeometry = new BufferGeometry() as BufferGeometryWithInfo;
  copyAttributesForRanges(mergedGeometry, ranges, totalVertexCount);
  copyAndRemapIndexForRanges(mergedGeometry, ranges, totalVertexCount);
  mergedGeometry.vertexSegmentMapping =
    VertexSegmentMapping.fromSegmentIdSortedCountList(rangeLengthAndIdsList);
  return mergedGeometry;
}

export function sortByDistanceTo(
  availableChunks: Vector3[] | meshApi.MeshChunk[] | null | undefined,
  seedPosition: Vector3,
) {
  return sortBy(availableChunks, (chunk: Vector3 | meshApi.MeshChunk) =>
    V3.length(V3.sub(seedPosition, "position" in chunk ? chunk.position : chunk)),
  ) as Array<Vector3> | Array<meshApi.MeshChunk>;
}
