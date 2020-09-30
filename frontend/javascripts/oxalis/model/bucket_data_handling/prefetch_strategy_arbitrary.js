// @flow

import { AbstractPrefetchStrategy } from "oxalis/model/bucket_data_handling/prefetch_strategy_plane";
import type { BoundingBoxType, Vector3 } from "oxalis/constants";
import { M4x4, type Matrix4x4, V3 } from "libs/mjs";
import type { PullQueueItem } from "oxalis/model/bucket_data_handling/pullqueue";
import { globalPositionToBucketPosition } from "oxalis/model/helpers/position_converter";
import PolyhedronRasterizer from "oxalis/model/bucket_data_handling/polyhedron_rasterizer";
import { ResolutionInfo } from "oxalis/model/accessors/dataset_accessor";

export class PrefetchStrategyArbitrary extends AbstractPrefetchStrategy {
  velocityRangeStart = 0;
  velocityRangeEnd = Infinity;
  roundTripTimeRangeStart = 0;
  roundTripTimeRangeEnd = Infinity;
  name = "ARBITRARY";

  prefetchPolyhedron: PolyhedronRasterizer.Master = PolyhedronRasterizer.Master.squareFrustum(
    7,
    7,
    -0.5,
    10,
    10,
    20,
  );

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

  prefetch(
    matrix: Matrix4x4,
    activeZoomStep: number,
    position: Vector3,
    resolutions: Array<Vector3>,
    resolutionInfo: ResolutionInfo,
  ): Array<PullQueueItem> {
    const pullQueue = [];
    const zoomStep = resolutionInfo.getIndexOrClosestHigherIndex(activeZoomStep);
    if (zoomStep == null) {
      // The layer cannot be rendered at this zoom step, as necessary magnifications
      // are missing. Don't prefetch anything.
      return pullQueue;
    }

    const matrix0 = M4x4.clone(matrix);
    this.modifyMatrixForPoly(matrix0, zoomStep);

    const polyhedron0 = this.prefetchPolyhedron.transformAffine(matrix0);
    const testAddresses = polyhedron0.collectPointsOnion(matrix0[12], matrix0[13], matrix0[14]);

    let i = 0;
    while (i < testAddresses.length) {
      const bucketX = testAddresses[i++];
      const bucketY = testAddresses[i++];
      const bucketZ = testAddresses[i++];

      const positionBucket = globalPositionToBucketPosition(position, resolutions, zoomStep);
      const distanceToPosition = V3.length(V3.sub([bucketX, bucketY, bucketZ], positionBucket));

      pullQueue.push({
        bucket: [bucketX, bucketY, bucketZ, zoomStep],
        priority: 1 + distanceToPosition,
      });
    }
    return pullQueue;
  }
}

export default {};
