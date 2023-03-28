import * as THREE from "three";
import Store from "oxalis/store";
import { getTDViewportLOD } from "oxalis/model/accessors/view_mode_accessor";

export default class CustomLOD extends THREE.LOD {
  noLODGroup: THREE.Group;
  lodLevelCount: number;
  constructor() {
    super();
    this.lodLevelCount = 0;
    this.noLODGroup = new THREE.Group();
    this.add(this.noLODGroup);
  }

  update(_camera: any) {
    const levels = this.levels;

    const visibleIndex = getTDViewportLOD(Store.getState());
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
