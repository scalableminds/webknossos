import type { meshApi } from "admin/rest_api";
import { V3 } from "libs/mjs";
import sortBy from "lodash-es/sortBy";
import sortedIndex from "lodash-es/sortedIndex";
import sortedIndexOf from "lodash-es/sortedIndexOf";
import { Box3, type BufferAttribute, type BufferGeometry } from "three";
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
}

export function sortByDistanceTo(
  availableChunks: Vector3[] | meshApi.MeshChunk[] | null | undefined,
  seedPosition: Vector3,
) {
  return sortBy(availableChunks, (chunk: Vector3 | meshApi.MeshChunk) =>
    V3.length(V3.sub(seedPosition, "position" in chunk ? chunk.position : chunk)),
  ) as Array<Vector3> | Array<meshApi.MeshChunk>;
}

// The copies of a chunk border vertex don't have exactly the same position in the
// neighboring chunks: scaling and translating each chunk in float32 leaves a rounding
// error that grows with the magnitude of the coordinates (~1e-6 relative). Vertices this
// close to each other are treated as the same vertex. Erring on the large side is fine,
// since unifying the normals of two distinct, close-by vertices only smooths the
// shading a little.
const BORDER_VERTEX_RELATIVE_TOLERANCE = 1e-5;
const BORDER_VERTEX_MIN_TOLERANCE = 1e-4;

/*
 * Precomputed meshes are loaded as independent chunks, each with vertex normals that
 * were computed only from that chunk's own triangles. A vertex on the border between
 * two chunks therefore exists once per chunk, and each copy gets a different normal,
 * which shows up as a visible seam in the shading (especially in specular highlights).
 *
 * This recomputes the normals of all chunk border vertices in the merged geometry as
 * if the chunks had been welded together, i.e. from the (area-weighted) face normals
 * of all triangles around that position, across all chunks. The vertices themselves
 * are deliberately not merged, since the VertexSegmentMapping relies on the vertex
 * ranges of the individual chunks. Border vertices of different unmapped segments are
 * not unified, since those surfaces belong to different (touching) segments.
 *
 * sortedBufferGeometries must be the geometries mergedGeometry was built from, in the
 * same order.
 */
export function unifyNormalsAtChunkBorders(
  mergedGeometry: BufferGeometry,
  sortedBufferGeometries: UnmergedBufferGeometryWithInfo[],
) {
  const positions = mergedGeometry.attributes.position.array;
  const normalAttribute = mergedGeometry.attributes.normal;
  if (normalAttribute == null) return;
  const normals = normalAttribute.array;
  const vertexCount = mergedGeometry.attributes.position.count;

  const chunkBoxes = sortedBufferGeometries.map((geometry) =>
    new Box3().setFromBufferAttribute(geometry.attributes.position as BufferAttribute),
  );
  const maxAbsoluteCoordinate = chunkBoxes.reduce(
    (maxCoordinate, { min, max }) =>
      Math.max(maxCoordinate, ...min.toArray().map(Math.abs), ...max.toArray().map(Math.abs)),
    0,
  );
  const tolerance = Math.max(
    maxAbsoluteCoordinate * BORDER_VERTEX_RELATIVE_TOLERANCE,
    BORDER_VERTEX_MIN_TOLERANCE,
  );
  // Border vertices are bucketed into a grid with cells twice as large as the tolerance.
  // That way, a vertex within the tolerance of another one is either in the same cell
  // or in the adjacent cell on the side the vertex is closer to (per axis), so at most
  // 8 cells need to be checked for each vertex.
  const cellSize = 2 * tolerance;

  // Assign each border vertex to a group of vertices sharing the same position (and
  // unmapped segment id). -1 marks vertices in the interior of a chunk.
  const groupIdPerVertex = new Int32Array(vertexCount).fill(-1);
  const groupPositions: number[] = [];
  const groupSegmentIds: bigint[] = [];
  const groupIdsByCell = new Map<string, number[]>();
  const findGroup = (x: number, y: number, z: number, segmentId: bigint): number | null => {
    const cell = [x, y, z].map((value) => value / cellSize);
    const [cellX, cellY, cellZ] = cell.map(Math.floor);
    const [stepX, stepY, stepZ] = cell.map((value) => (value - Math.floor(value) < 0.5 ? -1 : 1));
    for (const neighborX of [cellX, cellX + stepX]) {
      for (const neighborY of [cellY, cellY + stepY]) {
        for (const neighborZ of [cellZ, cellZ + stepZ]) {
          for (const groupId of groupIdsByCell.get(`${neighborX},${neighborY},${neighborZ}`) ??
            []) {
            if (
              groupSegmentIds[groupId] === segmentId &&
              Math.abs(groupPositions[3 * groupId] - x) <= tolerance &&
              Math.abs(groupPositions[3 * groupId + 1] - y) <= tolerance &&
              Math.abs(groupPositions[3 * groupId + 2] - z) <= tolerance
            ) {
              return groupId;
            }
          }
        }
      }
    }
    return null;
  };

  let vertexOffset = 0;
  for (let chunkIndex = 0; chunkIndex < sortedBufferGeometries.length; chunkIndex++) {
    const geometry = sortedBufferGeometries[chunkIndex];
    const { min, max } = chunkBoxes[chunkIndex];
    const chunkVertexCount = geometry.attributes.position.count;
    for (let vertex = vertexOffset; vertex < vertexOffset + chunkVertexCount; vertex++) {
      const x = positions[3 * vertex];
      const y = positions[3 * vertex + 1];
      const z = positions[3 * vertex + 2];
      const isOnBorder =
        x - min.x <= tolerance ||
        max.x - x <= tolerance ||
        y - min.y <= tolerance ||
        max.y - y <= tolerance ||
        z - min.z <= tolerance ||
        max.z - z <= tolerance;
      if (!isOnBorder) continue;
      let groupId = findGroup(x, y, z, geometry.unmappedSegmentId);
      if (groupId == null) {
        groupId = groupSegmentIds.length;
        groupPositions.push(x, y, z);
        groupSegmentIds.push(geometry.unmappedSegmentId);
        const cellKey = [x, y, z].map((value) => Math.floor(value / cellSize)).join(",");
        const groupIdsInCell = groupIdsByCell.get(cellKey);
        if (groupIdsInCell == null) {
          groupIdsByCell.set(cellKey, [groupId]);
        } else {
          groupIdsInCell.push(groupId);
        }
      }
      groupIdPerVertex[vertex] = groupId;
    }
    vertexOffset += chunkVertexCount;
  }
  const groupCount = groupSegmentIds.length;
  if (groupCount === 0) return;

  // Accumulate the (unnormalized, thus area-weighted) face normals of all triangles
  // touching a border vertex into that vertex's group. This mirrors what
  // BufferGeometry.computeVertexNormals does for a single chunk.
  const groupNormals = new Float64Array(3 * groupCount);
  const index = mergedGeometry.index?.array;
  const triangleCount = (index != null ? index.length : vertexCount) / 3;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = index != null ? index[3 * triangle] : 3 * triangle;
    const b = index != null ? index[3 * triangle + 1] : 3 * triangle + 1;
    const c = index != null ? index[3 * triangle + 2] : 3 * triangle + 2;
    if (groupIdPerVertex[a] === -1 && groupIdPerVertex[b] === -1 && groupIdPerVertex[c] === -1) {
      continue;
    }
    const abX = positions[3 * b] - positions[3 * a];
    const abY = positions[3 * b + 1] - positions[3 * a + 1];
    const abZ = positions[3 * b + 2] - positions[3 * a + 2];
    const acX = positions[3 * c] - positions[3 * a];
    const acY = positions[3 * c + 1] - positions[3 * a + 1];
    const acZ = positions[3 * c + 2] - positions[3 * a + 2];
    const faceNormalX = abY * acZ - abZ * acY;
    const faceNormalY = abZ * acX - abX * acZ;
    const faceNormalZ = abX * acY - abY * acX;
    for (const vertex of [a, b, c]) {
      const groupId = groupIdPerVertex[vertex];
      if (groupId === -1) continue;
      groupNormals[3 * groupId] += faceNormalX;
      groupNormals[3 * groupId + 1] += faceNormalY;
      groupNormals[3 * groupId + 2] += faceNormalZ;
    }
  }

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const groupId = groupIdPerVertex[vertex];
    if (groupId === -1) continue;
    const x = groupNormals[3 * groupId];
    const y = groupNormals[3 * groupId + 1];
    const z = groupNormals[3 * groupId + 2];
    const length = Math.hypot(x, y, z);
    if (length === 0) continue;
    normals[3 * vertex] = x / length;
    normals[3 * vertex + 1] = y / length;
    normals[3 * vertex + 2] = z / length;
  }
  normalAttribute.needsUpdate = true;
}
