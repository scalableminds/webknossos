import { getTDViewZoom } from "oxalis/model/accessors/view_mode_accessor";
import Store from "oxalis/store";
import * as THREE from "three";

export default class CustomLOD extends THREE.LOD {
  noLODGroup: THREE.Group;
  lodLevelCount: number;
  lodThresholds: number[];
  constructor() {
    super();
    this.lodLevelCount = 0;
    this.noLODGroup = new THREE.Group();
    this.add(this.noLODGroup);
    this.lodThresholds = [0.7, 3];
  }

  getCurrentLOD(): number {
    const state = Store.getState();
    const scale = getTDViewZoom(state);
    let currentIndex = 0;
    while (scale > this.lodThresholds[currentIndex] && currentIndex < this.lodLevelCount - 1) {
      currentIndex++;
    }
    return currentIndex;
  }

  update(_camera: any) {
    const levels = this.levels;

    const visibleIndex = this.getCurrentLOD();
    for (let i = 0; i < this.levels.length; i++) {
      levels[i].object.visible = i === visibleIndex;
    }
  }

  addNoLODSupportedMesh(meshGroup: THREE.Group) {
    this.noLODGroup.add(meshGroup);
  }

  addLODMesh(meshGroup: THREE.Group, level: number) {
    while (this.lodLevelCount <= level) {
      this.addLevel(new THREE.Group(), this.lodLevelCount);
      this.lodLevelCount++;
      // Add a new threshold if the number of thresholds is not sufficient.
      // A new threshold is only needed if LOD count is greater than the count of thresholds
      // as the last threshold is also used for all scales greater than itself.
      // Thus this.lodThresholds.length will always be equal to this.lodLevelCount - 1.
      if (this.lodLevelCount > this.lodThresholds.length) {
        this.lodThresholds.push(this.lodThresholds[this.lodThresholds.length - 1] * 2);
      }
    }
    this.levels[level].object.add(meshGroup);
  }

  removeNoLODSupportedMesh(meshGroup: THREE.Group) {
    this.noLODGroup.remove(meshGroup);
  }

  removeLODMesh(meshGroup: THREE.Group, level: number) {
    this.levels[level].object.remove(meshGroup);
  }
}
