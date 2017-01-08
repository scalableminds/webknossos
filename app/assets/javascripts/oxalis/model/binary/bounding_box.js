import _ from "lodash";

class BoundingBox {


  constructor(boundingBox, cube) {
    this.boundingBox = boundingBox;
    this.cube = cube;
    this.BUCKET_SIZE_P = this.cube.BUCKET_SIZE_P;
    this.BYTE_OFFSET = this.cube.BYTE_OFFSET;
    // Min is including
    this.min = [0, 0, 0];
    // Max is excluding
    this.max = this.cube.upperBoundary.slice();

    if (this.boundingBox != null) {
      for (let i = 0; i <= 2; i++) {
        this.min[i] = Math.max(this.min[i], this.boundingBox.min[i]);
        this.max[i] = Math.min(this.max[i], this.boundingBox.max[i]);
      }
    }
  }


  getBoxForZoomStep(zoomStep) {
    return {
      min: _.map(this.min, e => e >> (this.BUCKET_SIZE_P + zoomStep)),
      max: _.map(this.max, (e) => {
        const shift = this.BUCKET_SIZE_P + zoomStep;
        let res = e >> shift;

        // Computing ceil(e / 2^shift)
        const remainder = e & ((1 << shift) - 1);
        if (remainder !== 0) {
          res += 1;
        }

        return res;
      },
      ),
    };
  }


  containsBucket([x, y, z, zoomStep]) {
    const { min, max } = this.getBoxForZoomStep(zoomStep);

    return (
      min[0] <= x && x < max[0] &&
      min[1] <= y && y < max[1] &&
      min[2] <= z && z < max[2]
    );
  }


  containsFullBucket([x, y, z, zoomStep]) {
    const { min, max } = this.getBoxForZoomStep(zoomStep);

    return (
      min[0] < x && x < max[0] - 1 &&
      min[1] < y && y < max[1] - 1 &&
      min[2] < z && z < max[2] - 1
    );
  }


  removeOutsideArea(bucket, bucketData) {
    if (this.containsFullBucket(bucket)) { return; }

    const baseVoxel = _.map(bucket.slice(0, 3), e => e << (this.BUCKET_SIZE_P + bucket[3]));

    for (const dx of __range__(0, (1 << this.BUCKET_SIZE_P), false)) {
      for (const dy of __range__(0, (1 << this.BUCKET_SIZE_P), false)) {
        for (const dz of __range__(0, (1 << this.BUCKET_SIZE_P), false)) {
          const x = baseVoxel[0] + (dx << bucket[3]);
          const y = baseVoxel[1] + (dy << bucket[3]);
          const z = baseVoxel[2] + (dz << bucket[3]);

          if (
            this.min[0] <= x && x < this.max[0] &&
            this.min[1] <= y && y < this.max[1] &&
            this.min[2] <= z && z < this.max[2]
          ) {
            continue;
          }

          const index = this.cube.getVoxelIndexByVoxelOffset([dx, dy, dz]);
          for (const b of __range__(0, this.BYTE_OFFSET, false)) {
            bucketData[index + b] = 0;
          }
        }
      }
    }
  }
}

export default BoundingBox;

function __range__(left, right, inclusive) {
  const range = [];
  const ascending = left < right;
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
