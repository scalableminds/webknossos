/**
 * ping_strategy_3d.js
 * @flow weak
 */

import { M4x4 } from "libs/mjs";
import PolyhedronRasterizer from "./polyhedron_rasterizer";
import { PingStrategy } from "./ping_strategy";

export class PingStrategy3d extends PingStrategy {

  static DslSlow : PingStrategy3d.DslSlow;

  getExtentObject(poly0, poly1, zoom0, zoom1) {
    return {
      minX: Math.min(poly0.minX << zoom0, poly1.minX << zoom1),
      minY: Math.min(poly0.minY << zoom0, poly1.minY << zoom1),
      minZ: Math.min(poly0.minZ << zoom0, poly1.minZ << zoom1),
      maxX: Math.max(poly0.maxX << zoom0, poly1.maxX << zoom1),
      maxY: Math.max(poly0.maxY << zoom0, poly1.maxY << zoom1),
      maxZ: Math.max(poly0.maxZ << zoom0, poly1.maxZ << zoom1),
    };
  }


  modifyMatrixForPoly(matrix, zoomStep) {
    matrix[12] >>= (5 + zoomStep);
    matrix[13] >>= (5 + zoomStep);
    matrix[14] >>= (5 + zoomStep);
    matrix[12] += 1;
    matrix[13] += 1;
    matrix[14] += 1;
  }
}


export class DslSlow extends PingStrategy3d {

  pingPolyhedron: PolyhedronRasterizer.Master;

  constructor(...args) {
    super(...args);
    this.velocityRangeStart = 0;
    this.velocityRangeEnd = Infinity;

    this.roundTripTimeRangeStart = 0;
    this.roundTripTimeRangeEnd = Infinity;

    this.name = "DSL_SLOW";

    this.pingPolyhedron = PolyhedronRasterizer.Master.squareFrustum(
      5, 5, -0.5,
      4, 4, 2,
    );
  }


  ping(matrix, zoomStep) {
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
