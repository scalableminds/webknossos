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
    return this.unmappedSegmentIds[index];
  }

  getRangeForPosition(position: number): [number, number] {
    const index = _.sortedIndex(this.cumulativeStartPosition, position) - 1;
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
