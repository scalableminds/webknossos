/**
 * arbitrary_plane.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";
import THREE from "three";
import { M4x4, V3 } from "libs/mjs";
import constants from "oxalis/constants";
import Flycam3d from "oxalis/model/flycam3d";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import Model from "oxalis/model";

import ArbitraryPlaneMaterialFactory from "./materials/arbitrary_plane_material_factory";

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
// For me detail look in Model.
//
// queryVertices: holds the position/matrices
// needed to for the bend surface.
// normalVertices: (depricated) holds the vertex postion
// for the flat surface
class ArbitraryPlane {

  cam: Flycam3d;
  model: Model;
  controller: ArbitraryController;
  mesh: THREE.Mesh;
  isDirty: boolean;
  queryVertices: Float32Array;
  width: number;
  // TODO: Probably unused? Recheck when flow coverage is higher
  height: number;
  x: number;
  textureMaterial: THREE.ShaderMaterial;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(cam, model, controller, width = 128) {
    this.isDirty = true;
    this.cam = cam;
    this.model = model;
    this.controller = controller;
    this.width = width;
    _.extend(this, Backbone.Events);

    this.mesh = this.createMesh();

    this.listenTo(this.cam, "changed", function () { this.isDirty = true; });
    this.listenTo(this.model.flycam, "positionChanged", function () { this.isDirty = true; });

    for (const name of Object.keys(this.model.binary)) {
      const binary = this.model.binary[name];
      binary.cube.on("bucketLoaded", () => { this.isDirty = true; });
    }

    if ((Math.log(this.width) / Math.LN2) % 1 === 1) { throw new Error("width needs to be a power of 2"); }
  }


  setMode(mode) {
    this.queryVertices = (() => {
      switch (mode) {
        case constants.MODE_ARBITRARY: return this.calculateSphereVertices();
        case constants.MODE_ARBITRARY_PLANE: return this.calculatePlaneVertices();
        default: throw new Error("Unrecognized mode:", mode);
      }
    })();

    this.isDirty = true;
  }


  attachScene(scene) {
    scene.add(this.mesh);
  }


  update() {
    if (this.isDirty) {
      const { mesh, cam } = this;

      const matrix = cam.getZoomedMatrix();

      const newVertices = M4x4.transformPointsAffine(matrix, this.queryVertices);
      const newColors = this.model.getColorBinaries()[0].getByVerticesSync(newVertices);

      this.textureMaterial.setData("color", newColors);

      const m = cam.getZoomedMatrix();

      mesh.matrix.set(m[0], m[4], m[8], m[12],
                      m[1], m[5], m[9], m[13],
                      m[2], m[6], m[10], m[14],
                      m[3], m[7], m[11], m[15]);

      mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      mesh.matrixWorldNeedsUpdate = true;

      this.isDirty = false;
    }
  }


  calculateSphereVertices(sphericalCapRadius) {
    if (sphericalCapRadius == null) { sphericalCapRadius = this.cam.distance; }
    const queryVertices = new Float32Array(this.width * this.width * 3);

    // so we have Point [0, 0, 0] centered
    let currentIndex = 0;

    const vertex = [0, 0, 0];
    let vector = [0, 0, 0];
    const centerVertex = [0, 0, -sphericalCapRadius];

    // Transforming those normalVertices to become a spherical cap
    // which is better more smooth for querying.
    // http://en.wikipedia.org/wiki/Spherical_cap
    for (let y = 0; y < this.width; y++) {
      for (let x = 0; x < this.width; x++) {
        vertex[0] = x - (Math.floor(this.width / 2));
        vertex[1] = y - (Math.floor(this.width / 2));
        vertex[2] = 0;

        vector = V3.sub(vertex, centerVertex, vector);
        const length = V3.length(vector);
        vector = V3.scale(vector, sphericalCapRadius / length, vector);

        queryVertices[currentIndex++] = centerVertex[0] + vector[0];
        queryVertices[currentIndex++] = centerVertex[1] + vector[1];
        queryVertices[currentIndex++] = centerVertex[2] + vector[2];
      }
    }

    return queryVertices;
  }


  calculatePlaneVertices() {
    const queryVertices = new Float32Array(this.width * this.width * 3);

    // so we have Point [0, 0, 0] centered
    let currentIndex = 0;

    for (let y = 0; y < this.width; y++) {
      for (let x = 0; x < this.width; x++) {
        queryVertices[currentIndex++] = x - (Math.floor(this.width / 2));
        queryVertices[currentIndex++] = y - (Math.floor(this.width / 2));
        queryVertices[currentIndex++] = 0;
      }
    }

    return queryVertices;
  }


  applyScale(delta) {
    this.x = Number(this.mesh.scale.x) + Number(delta);

    if (this.x > 0.5 && this.x < 10) {
      this.mesh.scale.x = this.mesh.scale.y = this.mesh.scale.z = this.x;
      this.cam.update();
    }
  }


  createMesh() {
    if (this.controller.isBranchpointvideoMode()) {
      const options = {
        polygonOffset: true,
        polygonOffsetFactor: 10.0,
        polygonOffsetUnits: 40.0,
      };

      const factory = new ArbitraryPlaneMaterialFactory(this.model, this.width);
      factory.makeMaterial(options);
      this.textureMaterial = factory.getMaterial();
    } else {
      this.textureMaterial = new ArbitraryPlaneMaterialFactory(this.model, this.width).getMaterial();
    }

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
