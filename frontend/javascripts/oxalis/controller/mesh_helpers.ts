import _ from "lodash";
import type * as THREE from "three";

export type BufferGeometryWithInfo = THREE.BufferGeometry & {
  positionToSegmentId?: PositionToSegmentId;
};

export type UnmergedBufferGeometryWithInfo = THREE.BufferGeometry & {
  unmappedSegmentId: number;
  positionToSegmentId?: PositionToSegmentId;
};

export class PositionToSegmentId {
  /*
   * This class is able to deal with buffer geometries.
   * Each geometry has an unmapped segment id (multiple ones can have
   * the same segment id) and various vertices.
   * All (sorted) geometries are concatenated and then indices are built
   * to allow for fast queries.
   * E.g., one query allows to go from a vertex index ("position") to
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
    this.cumulativeStartPosition.push(cumsum);
  }

  getUnmappedSegmentIdForPosition(position: number) {
    const index = _.sortedIndex(this.cumulativeStartPosition, position) - 1;
    if (index >= this.unmappedSegmentIds.length) {
      throw new Error(`Could not look up id for position=${position} in PositionToSegmentId.`);
    }
    return this.unmappedSegmentIds[index];
  }

  getRangeForPosition(position: number): [number, number] {
    const index = _.sortedIndex(this.cumulativeStartPosition, position) - 1;
    if (index + 1 >= this.cumulativeStartPosition.length) {
      throw new Error(`Could not look up range for position=${position} in PositionToSegmentId.`);
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
