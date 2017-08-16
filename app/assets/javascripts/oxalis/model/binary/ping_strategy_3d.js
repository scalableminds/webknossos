/**
 * ping_strategy_3d.js
 * @flow
 */

import { M4x4 } from "libs/mjs";
import type { Matrix4x4 } from "libs/mjs";
import type { BoundingBoxType } from "oxalis/constants";
import PolyhedronRasterizer from "oxalis/model/binary/polyhedron_rasterizer";
import { AbstractPingStrategy } from "oxalis/model/binary/ping_strategy";
import type { PullQueueItemType } from "oxalis/model/binary/pullqueue";

export class PingStrategy3d extends AbstractPingStrategy {
  getExtentObject(
    poly0: BoundingBoxType,
    poly1: BoundingBoxType,
    zoom0: number,
    zoom1: number,
  ): BoundingBoxType {
    return {
      min: [
        Math.min(poly0.min[0] << zoom0, poly1.min[0] << zoom1),
        Math.min(poly0.min[1] << zoom0, poly1.min[1] << zoom1),
        Math.min(poly0.min[2] << zoom0, poly1.min[2] << zoom1),
      ],
      max: [
        Math.max(poly0.max[0] << zoom0, poly1.max[0] << zoom1),
        Math.max(poly0.max[1] << zoom0, poly1.max[1] << zoom1),
        Math.max(poly0.max[2] << zoom0, poly1.max[2] << zoom1),
      ],
    };
  }

  modifyMatrixForPoly(matrix: Matrix4x4, zoomStep: number) {
    matrix[12] >>= 5 + zoomStep;
    matrix[13] >>= 5 + zoomStep;
    matrix[14] >>= 5 + zoomStep;
    matrix[12] += 1;
    matrix[13] += 1;
    matrix[14] += 1;
  }

  // eslint-disable-next-line no-unused-vars
  ping(matrix: Matrix4x4, zoomStep: number): Array<PullQueueItemType> {
    return [];
  }
}

export class DslSlowPingStrategy3d extends PingStrategy3d {
  pingPolyhedron: PolyhedronRasterizer.Master;

  velocityRangeStart = 0;
  velocityRangeEnd = Infinity;

  roundTripTimeRangeStart = 0;
  roundTripTimeRangeEnd = Infinity;

  name = "DSL_SLOW";

  pingPolyhedron = PolyhedronRasterizer.Master.squareFrustum(5, 5, -0.5, 4, 4, 2);

  ping(matrix: Matrix4x4, zoomStep: number): Array<PullQueueItemType> {
    const pullQueue = [];

    const matrix0 = M4x4.clone(matrix);
    this.modifyMatrixForPoly(matrix0, zoomStep);

    const polyhedron0 = this.pingPolyhedron.transformAffine(matrix0);
    const testAddresses = polyhedron0.collectPointsOnion(matrix0[12], matrix0[13], matrix0[14]);

    let i = 0;
    while (i < testAddresses.length) {
      const bucketX = testAddresses[i++];
      const bucketY = testAddresses[i++];
      const bucketZ = testAddresses[i++];

      pullQueue.push({ bucket: [bucketX, bucketY, bucketZ, zoomStep], priority: 0 });
    }
    return pullQueue;
  }
}
