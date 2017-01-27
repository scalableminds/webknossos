/**
 * mesh.js
 * @flow weak
 */

import * as THREE from "three";
import Deferred from "../../libs/deferred";

// This loads and caches meshes.

class Mesh {
  static LOAD_TIMEOUT = 30000;
  mesh: THREE.Mesh;

  constructor(geometry) {
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, shading: THREE.NoShading, vertexColors: THREE.VertexColors }),
    );
  }


  setPosition(x, y, z) {
    const { mesh } = this;
    mesh.position.x = x;
    mesh.position.y = y;
    mesh.position.z = z;
  }


  attachScene(scene) {
    return scene.add(this.mesh);
  }


  static load(filename) {
    const deferred = new Deferred();

    new THREE.JSONLoader().load(
      `/assets/mesh/${filename}`,
      geometry => deferred.resolve(new this(geometry)),
    );

    setTimeout(
      () => deferred.reject("timeout"),
      this.LOAD_TIMEOUT,
    );

    return deferred.promise();
  }
}

export default Mesh;
