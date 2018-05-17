/**
 * arbitrary_plane.js
 * @flow
 */

import _ from "lodash";
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import constants, { OrthoViews } from "oxalis/constants";
import type { Vector4 } from "oxalis/constants";
import Model from "oxalis/model";
import Store from "oxalis/throttled_store";
import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import SceneController from "oxalis/controller/scene_controller";

import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";

// Let's set up our trianglesplane.
// It serves as a "canvas" where the brain images
// are drawn.
// Don't let the name fool you, this is just an
// ordinary plane with a texture applied to it.
//
// User tests showed that looking a bend surface (a half sphere)
// feels more natural when moving around in 3D space.
// To acknowledge this fact we determine the pixels that will
// be displayed by requesting them as though they were
// attached to bend surface.
// The result is then projected on a flat surface.

class ArbitraryPlane {
  mesh: THREE.Mesh;
  isDirty: boolean;
  width: number;
  // TODO: Probably unused? Recheck when flow coverage is higher
  height: number;
  x: number;
  textureMaterial: THREE.RawShaderMaterial;

  constructor() {
    this.isDirty = true;
    this.height = 0;
    this.width = constants.VIEWPORT_WIDTH; //  * 1.125
    _.extend(this, BackboneEvents);

    this.mesh = this.createMesh();

    for (const name of Object.keys(Model.binary)) {
      const binary = Model.binary[name];
      binary.cube.on("bucketLoaded", () => {
        this.isDirty = true;
      });
    }

    Store.subscribe(() => {
      this.isDirty = true;
    });
  }

  updateAnchorPoints(anchorPoint: ?Vector4, fallbackAnchorPoint: ?Vector4): void {
    if (anchorPoint) {
      console.log("setAnchorPoint");
      this.mesh.material.setAnchorPoint(anchorPoint);
    }
    if (fallbackAnchorPoint) {
      this.mesh.material.setFallbackAnchorPoint(fallbackAnchorPoint);
    }
  }

  setPosition = ({ x, y, z }: THREE.Vector3) => {
    this.mesh.material.setGlobalPosition([x, y, z]);
  };

  addToScene(scene: THREE.Scene) {
    scene.add(this.mesh);
  }

  update() {
    if (this.isDirty) {
      const { mesh } = this;

      const matrix = getZoomedMatrix(Store.getState().flycam);

      mesh.matrix.set(
        matrix[0],
        matrix[4],
        matrix[8],
        matrix[12],
        matrix[1],
        matrix[5],
        matrix[9],
        matrix[13],
        matrix[2],
        matrix[6],
        matrix[10],
        matrix[14],
        matrix[3],
        matrix[7],
        matrix[11],
        matrix[15],
      );

      mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      mesh.matrixWorldNeedsUpdate = true;

      this.isDirty = false;

      SceneController.update(this);
      console.log("trigger SceneController update");
    }
  }

  createMesh() {
    this.textureMaterial = new PlaneMaterialFactory(0, {}, OrthoViews.PLANE_XY, 4)
      .setup()
      .getMaterial();

    // create mesh
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, this.width, 1, 1),
      this.textureMaterial,
    );
    plane.rotation.x = Math.PI;
    this.x = 1;

    plane.matrixAutoUpdate = false;
    plane.doubleSided = true;

    return plane;
  }
}

export default ArbitraryPlane;
