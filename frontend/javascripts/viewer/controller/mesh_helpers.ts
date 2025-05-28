import type { meshApi } from "admin/rest_api";
import { V3 } from "libs/mjs";
import _ from "lodash";
import type * as THREE from "three";
import type { Vector3 } from "viewer/constants";

export type BufferGeometryWithInfo = THREE.BufferGeometry & {
  vertexSegmentMapping?: VertexSegmentMapping;
};

export type UnmergedBufferGeometryWithInfo = THREE.BufferGeometry & {
  unmappedSegmentId: number;
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
   * Similarily, one can obtain the range that covers all vertices
   * that belong to a certain unmapped segment id.
   * Other queries allow a similar mapping between vertex index ("position")
   * and unmapped segment id.
   */
  cumulativeStartPosition: number[];
  unmappedSegmentIds: number[];
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
    const index = _.sortedIndex(this.cumulativeStartPosition, position) - 1;
    if (index >= this.unmappedSegmentIds.length) {
      throw new Error(`Could not look up id for position=${position} in VertexSegmentMapping.`);
    }
    return this.unmappedSegmentIds[index];
  }

  getRangeForPosition(position: number): [number, number] {
    const index = _.sortedIndex(this.cumulativeStartPosition, position) - 1;
    if (index + 1 >= this.cumulativeStartPosition.length) {
      throw new Error(`Could not look up range for position=${position} in VertexSegmentMapping.`);
    }
    return [this.cumulativeStartPosition[index], this.cumulativeStartPosition[index + 1]];
  }

  getRangeForUnmappedSegmentId(segmentId: number): [number, number] | null {
    const index = _.sortedIndexOf(this.unmappedSegmentIds, segmentId);
    if (index === -1) {
      return null;
    }
    return [this.cumulativeStartPosition[index], this.cumulativeStartPosition[index + 1]];
  }

  containsSegmentId(segmentId: number): boolean {
    return _.sortedIndexOf(this.unmappedSegmentIds, segmentId) !== -1;
  }
}

export function sortByDistanceTo(
  availableChunks: Vector3[] | meshApi.MeshChunk[] | null | undefined,
  seedPosition: Vector3,
) {
  return _.sortBy(availableChunks, (chunk: Vector3 | meshApi.MeshChunk) =>
    V3.length(V3.sub(seedPosition, "position" in chunk ? chunk.position : chunk)),
  ) as Array<Vector3> | Array<meshApi.MeshChunk>;
}
