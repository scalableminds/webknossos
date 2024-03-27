import * as THREE from "three";
import Store from "oxalis/store";
import { getTDViewZoom } from "oxalis/model/accessors/view_mode_accessor";

export default class CustomLOD extends THREE.LOD {
  noLODGroup: THREE.Group;
  lodLevelCount: number;

  constructor() {
    super();
    this.lodLevelCount = 0;
    this.noLODGroup = new THREE.Group();
    this.add(this.noLODGroup);
  }

  getCurrentLOD(maxLod?: number): number {
    // The maxLod parameter indicates which LODs are available if no LOD mesh was added before
    const maxIndex = maxLod != null ? maxLod : this.lodLevelCount - 1;
    const state = Store.getState();
    const scale = getTDViewZoom(state);
    let currentIndex = 0;
    while (scale > this.getLODThresholdForLevel(currentIndex) && currentIndex < maxIndex) {
      currentIndex++;
    }
    return currentIndex;
  }

  getLODThresholdForLevel(level: number) {
    if (level === 0) {
      return 0.7;
    }

    // This will return 3 for level 1 and then double for each additional level
    return 2 ** (level - 1) * 3;
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
