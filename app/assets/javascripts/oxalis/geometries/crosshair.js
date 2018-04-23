/**
 * crosshair.js
 * @flow
 */

import * as THREE from "three";
import Store from "oxalis/store";
import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";

class Crosshair {
  mesh: THREE.Mesh;
  WIDTH: number;
  COLOR: string;
  SCALE_MIN: number;
  SCALE_MAX: number;

  context: CanvasRenderingContext2D;
  scale: number;

  isDirty: boolean;

  constructor(scale: number) {
    this.WIDTH = 256;
    this.COLOR = "#2895FF";
    this.SCALE_MIN = 0.01;
    this.SCALE_MAX = 1;
    this.scale = 0;
    this.isDirty = true;

    const canvas = document.createElement("canvas");
    canvas.width = this.WIDTH;
    canvas.height = this.WIDTH;
    this.context = this.getContext(canvas);

    this.mesh = this.createMesh(canvas);

    this.setScale(scale);
  }

  getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      return ctx;
    }
    throw new Error("Could not retrieve 2d context");
  }

  setVisibility(v: boolean) {
    this.mesh.visible = v;
  }

  update() {
    const { context, WIDTH, COLOR, mesh } = this;
    const m = getZoomedMatrix(Store.getState().flycam);

    mesh.matrix.set(
      m[0],
      m[4],
      m[8],
      m[12],
      m[1],
      m[5],
      m[9],
      m[13],
      m[2],
      m[6],
      m[10],
      m[14],
      m[3],
      m[7],
      m[11],
      m[15],
    );

    mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    mesh.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.5));
    mesh.matrix.scale(new THREE.Vector3(this.scale, this.scale, this.scale));

    mesh.matrixWorldNeedsUpdate = true;

    this.isDirty = false;
  }

  setScale(value: number) {
    const { SCALE_MIN, SCALE_MAX } = this;

    if (value > SCALE_MIN && value < SCALE_MAX) {
      this.scale = value;
      this.isDirty = true;
    }
  }

  addToScene(scene: THREE.Scene) {
    scene.add(this.mesh);
  }

  createMesh(canvas: HTMLCanvasElement) {
    const { WIDTH } = this;

    const createCircle = radius => {
      var segments = 64,
        material = new THREE.LineBasicMaterial({ color: this.COLOR }),
        geometry = new THREE.CircleGeometry(radius, segments);

      // Remove center vertex
      geometry.vertices.shift();

      return new THREE.LineLoop(geometry, material);
    };

    var mesh = new THREE.Group();
    const outerCircle = createCircle(WIDTH / 2);
    mesh.add(outerCircle);

    const innerCircle = createCircle(4);
    mesh.add(innerCircle);

    mesh.rotation.x = Math.PI;

    mesh.matrixAutoUpdate = false;
    mesh.doubleSided = true;

    return mesh;
  }
}

export default Crosshair;
