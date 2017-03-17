/**
 * crosshair.js
 * @flow
 */

import * as THREE from "three";
import Store from "oxalis/store";
import { getZoomedMatrix } from "oxalis/model/accessors/flycam3d_accessor";

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
    this.WIDTH = 200;
    this.COLOR = "#2895FF";
    this.SCALE_MIN = 0.01;
    this.SCALE_MAX = 1;
    this.scale = 0;
    this.isDirty = true;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = this.WIDTH;
    this.context = this.getContext(canvas);

    this.mesh = this.createMesh(canvas);

    this.mesh.setVisibility = function (v) {
      this.arbitraryVisible = v;
      this.updateVisibility();
    };

    this.mesh.setVisibilityEnabled = function (v) {
      this.visibilityEnabled = v;
      this.updateVisibility();
    };

    this.mesh.updateVisibility = function () {
      this.visible = this.arbitraryVisible && this.visibilityEnabled;
    };

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
    this.mesh.setVisibilityEnabled(v);
  }


  update() {
    const { context, WIDTH, COLOR, mesh } = this;

    if (this.isDirty) {
      context.clearRect(0, 0, WIDTH, WIDTH);

      context.fillStyle = COLOR;
      context.strokeStyle = COLOR;

      context.lineWidth = 3;
      context.moveTo(WIDTH / 2, 3);
      context.beginPath();
      context.arc(WIDTH / 2, WIDTH / 2, (WIDTH / 2) - 3, 0, 2 * Math.PI);
      context.stroke();

      context.beginPath();
      context.moveTo(WIDTH / 2, (WIDTH / 2) - 1);
      context.arc(WIDTH / 2, WIDTH / 2, 4, 0, 2 * Math.PI, true);
      context.fill();

      mesh.material.map.needsUpdate = true;
    }

    const m = getZoomedMatrix(Store.getState().flycam);

    mesh.matrix.set(m[0], m[4], m[8], m[12],
                    m[1], m[5], m[9], m[13],
                    m[2], m[6], m[10], m[14],
                    m[3], m[7], m[11], m[15]);

    mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    mesh.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.5));
    mesh.matrix.scale(new THREE.Vector3(this.scale, this.scale, this.scale));

    mesh.matrixWorldNeedsUpdate = true;

    this.isDirty = false;
  }


  setScale(value: number) {
    // eslint-disable-next-line no-unused-vars
    const { SCALE_MIN, SCALE_MAX, mesh } = this;

    if (value > SCALE_MIN && value < SCALE_MAX) {
      this.scale = value;
    }

    this.isDirty = true;
  }


  attachScene(scene: THREE.Scene) {
    return scene.add(this.mesh);
  }


  createMesh(canvas: HTMLCanvasElement) {
    const { WIDTH } = this;

    const texture = new THREE.Texture(canvas);

    const material = new THREE.MeshBasicMaterial({ map: texture });
    material.transparent = true;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, WIDTH),
      material,
    );

    mesh.rotation.x = Math.PI;

    mesh.matrixAutoUpdate = false;
    mesh.doubleSided = true;

    return mesh;
  }
}

export default Crosshair;
