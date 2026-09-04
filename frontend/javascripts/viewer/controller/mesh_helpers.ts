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
   * through the normal constructor (which expects actual buffer geometries). Used when a
   * sub-geometry is sliced out of an already-merged geometry (see extractSubGeometry in
   * segment_mesh_controller.ts): the caller already knows, per kept unmapped segment id, how
   * many vertices were carried over, and the ids are already in sorted order because they were
   * filtered from an existing (sorted) VertexSegmentMapping.
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

// Copies every attribute (position, normal, ...) from sourceGeometry into targetGeometry,
// keeping only the vertex-attribute ranges listed in `ranges` (each [start, end) pair is a range
// of vertex indices, in the units BufferGeometry itself uses for e.g. draw ranges - not raw array
// offsets; those get derived below via itemSize). `color` is skipped: it's uniform-per-segment and
// gets (re-)applied once the extracted geometry is registered under its new segment id (see
// SegmentMeshController.constructMesh / setMeshColor), so the old segment's color doesn't need to
// be carried over.
function copyAttributesForRanges(
  sourceGeometry: BufferGeometry,
  targetGeometry: BufferGeometry,
  ranges: Array<[number, number]>,
  totalVertexCount: number,
): void {
  const attributeNamesToCopy = Object.keys(sourceGeometry.attributes).filter(
    (name) => name !== "color",
  );
  for (const attributeName of attributeNamesToCopy) {
    const oldAttribute = sourceGeometry.getAttribute(attributeName);
    const oldArray = oldAttribute.array as unknown as {
      constructor: new (length: number) => typeof oldAttribute.array;
      subarray: (start: number, end: number) => typeof oldAttribute.array;
    };
    const itemSize = oldAttribute.itemSize;
    // Create a new array of the same type as the previous attribute array (Float32Array |
    // Uint16Array | Int16Array | ...), sized for just the extracted vertices.
    const newArray = new oldArray.constructor(totalVertexCount * itemSize) as unknown as {
      set: (source: typeof oldAttribute.array, offset: number) => void;
    };
    let writeOffset = 0;
    // Copy over the ranges of the extracted part of the mesh.
    for (const [start, end] of ranges) {
      newArray.set(oldArray.subarray(start * itemSize, end * itemSize), writeOffset);
      writeOffset += (end - start) * itemSize;
    }
    // newArray's concrete TypedArray subtype is only known at runtime (it mirrors whatever type
    // the source attribute happened to use).
    targetGeometry.setAttribute(
      attributeName,
      new BufferAttribute(newArray as any, itemSize, oldAttribute.normalized),
    );
  }
}

// Copies sourceGeometry's index (triangle) buffer into targetGeometry, keeping only triangles
// whose vertices all fall within `ranges`, and rewriting ("remapping") their vertex indices to
// point into the *new*, compacted attribute arrays that copyAttributesForRanges produced - the
// index buffer stores vertex indices (positions into the position/normal/... arrays), not raw
// data, so once vertices are dropped and the remaining ones shift down to fill the gap, every
// surviving triangle's indices have to be translated to match. No-op if sourceGeometry isn't
// indexed.
function copyAndRemapIndexForRanges(
  sourceGeometry: BufferGeometry,
  targetGeometry: BufferGeometry,
  ranges: Array<[number, number]>,
  totalVertexCount: number,
): void {
  if (sourceGeometry.index == null) return;

  // For each kept old vertex index, the slot it now occupies in the new (compacted) attribute
  // arrays - built in the same order copyAttributesForRanges concatenated the ranges in, so the
  // numbering here matches exactly where each vertex's data actually ended up.
  const oldToNewVertexIndex = new Map<number, number>();
  let newVertexIndex = 0;
  for (const [start, end] of ranges) {
    for (let oldVertexIndex = start; oldVertexIndex < end; oldVertexIndex++) {
      oldToNewVertexIndex.set(oldVertexIndex, newVertexIndex);
      newVertexIndex++;
    }
  }

  // Chunks are geometrically disjoint (each triangle's vertices all belong to the same unmapped
  // segment id), so a triangle is either fully kept or fully dropped - no triangle straddles a
  // kept/dropped boundary.
  const oldIndices = sourceGeometry.index.array;
  const newIndices: number[] = [];
  for (let i = 0; i < oldIndices.length; i += 3) {
    const a = oldToNewVertexIndex.get(oldIndices[i]);
    const b = oldToNewVertexIndex.get(oldIndices[i + 1]);
    const c = oldToNewVertexIndex.get(oldIndices[i + 2]);
    if (a != null && b != null && c != null) {
      newIndices.push(a, b, c);
    }
  }
  const IndexArrayCtor = totalVertexCount > 65535 ? Uint32Array : Uint16Array;
  targetGeometry.setIndex(new IndexArrayCtor(newIndices) as unknown as number[]);
}

/**
 * Slices a subset of unmapped/supervoxel ids out of a merged mesh geometry (one that carries a
 * vertexSegmentMapping, i.e. a precomputed mesh's merged chunk geometry - see
 * precomputed_mesh_saga.ts), returning a new, independent BufferGeometry containing only the
 * vertices (and, if indexed, only the triangles) belonging to `keepIds`. Returns null if the
 * geometry has no vertexSegmentMapping (e.g. an ad-hoc mesh, or a precomputed mesh that fell back
 * to unmerged chunks) or if none of `keepIds` are present in it.
 *
 * Used to locally split a proofreading agglomerate's mesh into its post-split pieces without a
 * network round-trip (see SegmentMeshController.splitMeshByUnmappedSegmentIds).
 */
export function extractSubGeometry(
  geometry: BufferGeometryWithInfo,
  keepIds: Set<bigint>,
): BufferGeometryWithInfo | null {
  const vertexSegmentMapping = geometry.vertexSegmentMapping;
  if (vertexSegmentMapping == null) return null;

  const { unmappedSegmentIds, cumulativeStartPosition } = vertexSegmentMapping;
  // Vertex-attribute ranges to keep, in the same (sorted-by-unmapped-segment-id) order as they
  // appear in the source geometry.
  const ranges: Array<[number, number]> = [];
  const keptEntries: Array<{ segmentId: bigint; count: number }> = [];
  for (let i = 0; i < unmappedSegmentIds.length; i++) {
    const segmentId = unmappedSegmentIds[i];
    if (keepIds.has(segmentId)) {
      const start = cumulativeStartPosition[i];
      const end = cumulativeStartPosition[i + 1];
      ranges.push([start, end]);
      keptEntries.push({ segmentId, count: end - start });
    }
  }
  if (ranges.length === 0) return null;

  const totalVertexCount = keptEntries.reduce((sum, entry) => sum + entry.count, 0);
  const newGeometry = new BufferGeometry() as BufferGeometryWithInfo;

  copyAttributesForRanges(geometry, newGeometry, ranges, totalVertexCount);
  copyAndRemapIndexForRanges(geometry, newGeometry, ranges, totalVertexCount);

  newGeometry.vertexSegmentMapping = VertexSegmentMapping.fromSegmentIdSortedCountList(keptEntries);
  return newGeometry;
}

export function sortByDistanceTo(
  availableChunks: Vector3[] | meshApi.MeshChunk[] | null | undefined,
  seedPosition: Vector3,
) {
  return sortBy(availableChunks, (chunk: Vector3 | meshApi.MeshChunk) =>
    V3.length(V3.sub(seedPosition, "position" in chunk ? chunk.position : chunk)),
  ) as Array<Vector3> | Array<meshApi.MeshChunk>;
}
