import PolyhedronRasterizer from "./polyhedron_rasterizer";
import { M4x4, V3 } from "libs/mjs";

class PingStrategy3d {
  static initClass() {

    this.prototype.velocityRangeStart  = 0;
    this.prototype.velocityRangeEnd  = 0;

    this.prototype.roundTripTimeRangeStart  = 0;
    this.prototype.roundTripTimeRangeEnd  = 0;

    this.prototype.contentTypes  = [];

    this.prototype.name  = 'Abstract';
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

    throw "Needs to be implemented in subclass";
  }


  getExtentObject(poly0, poly1, zoom0, zoom1) {

    return {
      min_x : Math.min(poly0.min_x << zoom0, poly1.min_x << zoom1),
      min_y : Math.min(poly0.min_y << zoom0, poly1.min_y << zoom1),
      min_z : Math.min(poly0.min_z << zoom0, poly1.min_z << zoom1),
      max_x : Math.max(poly0.max_x << zoom0, poly1.max_x << zoom1),
      max_y : Math.max(poly0.max_y << zoom0, poly1.max_y << zoom1),
      max_z : Math.max(poly0.max_z << zoom0, poly1.max_z << zoom1)
    };
  }


  modifyMatrixForPoly(matrix, zoomStep) {

    matrix[12] >>= (5 + zoomStep);
    matrix[13] >>= (5 + zoomStep);
    matrix[14] >>= (5 + zoomStep);
    matrix[12] += 1;
    matrix[13] += 1;
    return matrix[14] += 1;
  }
}
PingStrategy3d.initClass();


PingStrategy3d.DslSlow = class DslSlow extends PingStrategy3d {
  static initClass() {

    this.prototype.velocityRangeStart  = 0;
    this.prototype.velocityRangeEnd  = Infinity;

    this.prototype.roundTripTimeRangeStart  = 0;
    this.prototype.roundTripTimeRangeEnd  = Infinity;

    this.prototype.name  = 'DSL_SLOW';

    this.prototype.pingPolyhedron  = PolyhedronRasterizer.Master.squareFrustum(
      5, 5, -0.5,
      4, 4, 2
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
      const bucket_x = testAddresses[i++];
      const bucket_y = testAddresses[i++];
      const bucket_z = testAddresses[i++];

      pullQueue.push({bucket: [bucket_x, bucket_y, bucket_z, zoomStep], priority: 0});
    }

    return pullQueue;
  }
};
PingStrategy3d.DslSlow.initClass();
    // priority 0 is highest


export default PingStrategy3d;
