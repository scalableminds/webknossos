import Utils from "libs/utils";
import THREE from "three";
// This class encapsulates any conversions between the nm and voxel
// coordinate system.
// It is a Singleton that is initalized once.
// Include with import scaleInfo from "oxalis/model/scaleinfo"

class ScaleInfo {

  initialize(scale) {
    this.nmPerVoxel = scale;

    this.voxelPerNM = [0, 0, 0];
    for (const i of Utils.__range__(0, (this.nmPerVoxel.length - 1), true)) {
      this.voxelPerNM[i] = 1 / this.nmPerVoxel[i];
    }

    // base voxel should be a cube with highest resolution
    this.baseVoxel = Math.min.apply(null, this.nmPerVoxel);

    // scale factor to calculate the voxels in a certain
    // dimension from baseVoxels
    this.baseVoxelFactors = [this.baseVoxel / this.nmPerVoxel[0],
      this.baseVoxel / this.nmPerVoxel[1],
      this.baseVoxel / this.nmPerVoxel[2]];
  }

  getNmPerVoxelVector() {
    return new THREE.Vector3(...this.nmPerVoxel);
  }


  getVoxelPerNMVector() {
    return new THREE.Vector3(...this.voxelPerNM);
  }


  voxelToNm(posArray) {
    return [0, 1, 2].map(i => posArray[i] * this.nmPerVoxel[i]);
  }


  baseVoxelToVoxel(baseVoxel) {
    let res = this.baseVoxelFactors.slice();
    for (let i = 0; i <= 2; i++) {
      res *= baseVoxel;
    }
    return res;
  }
}

export default new ScaleInfo();
