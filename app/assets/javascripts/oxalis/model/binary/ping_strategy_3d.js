import _ from "lodash";
import { M4x4 } from "libs/mjs";
import PolyhedronRasterizer from "./polyhedron_rasterizer";

class PingStrategy3d {
  static initClass() {
    this.prototype.velocityRangeStart = 0;
    this.prototype.velocityRangeEnd = 0;

    this.prototype.roundTripTimeRangeStart = 0;
    this.prototype.roundTripTimeRangeEnd = 0;

    this.prototype.contentTypes = [];

    this.prototype.name = "Abstract";
  }


  forContentType(contentType) {
    return _.isEmpty(this.contentTypes) || _.includes(this.contentTypes, contentType);
  }


  inVelocityRange(value) {
    return this.velocityRangeStart <= value && value <= this.velocityRangeEnd;
  }


  inRoundTripTimeRange(value) {
    return this.roundTripTimeRangeStart <= value && value <= this.roundTripTimeRangeEnd;
  }


  ping() {
    throw Error("Needs to be implemented in subclass");
  }


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
PingStrategy3d.initClass();


PingStrategy3d.DslSlow = class DslSlow extends PingStrategy3d {
  static initClass() {
    this.prototype.velocityRangeStart = 0;
    this.prototype.velocityRangeEnd = Infinity;

    this.prototype.roundTripTimeRangeStart = 0;
    this.prototype.roundTripTimeRangeEnd = Infinity;

    this.prototype.name = "DSL_SLOW";

    this.prototype.pingPolyhedron = PolyhedronRasterizer.Master.squareFrustum(
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
};
PingStrategy3d.DslSlow.initClass();
    // priority 0 is highest


export default PingStrategy3d;
