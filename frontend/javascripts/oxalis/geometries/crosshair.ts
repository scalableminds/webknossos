import * as THREE from "three";
import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import Store from "oxalis/store";

class Crosshair {
  mesh: typeof THREE.Mesh;
  WIDTH: number;
  COLOR: string;
  SCALE_MIN: number;
  SCALE_MAX: number;
  scale: number;
  isDirty: boolean;

  constructor(scale: number) {
    this.WIDTH = 256;
    this.COLOR = "#1BFF76";
    this.SCALE_MIN = 0.01;
    this.SCALE_MAX = 1;
    this.scale = 0;
    this.isDirty = true;
    // @ts-expect-error ts-migrate(2739) FIXME: Type 'Group' is missing the following properties f... Remove this comment to see the full error message
    this.mesh = this.createMesh();
    this.setScale(scale);
  }

  setVisibility(v: boolean) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'typeof ... Remove this comment to see the full error message
    this.mesh.visible = v;
  }

  update() {
    const { mesh } = this;
    const m = getZoomedMatrix(Store.getState().flycam);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matrix' does not exist on type 'typeof M... Remove this comment to see the full error message
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
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matrix' does not exist on type 'typeof M... Remove this comment to see the full error message
    mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matrix' does not exist on type 'typeof M... Remove this comment to see the full error message
    mesh.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.5));
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matrix' does not exist on type 'typeof M... Remove this comment to see the full error message
    mesh.matrix.scale(new THREE.Vector3(this.scale, this.scale, this.scale));
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'matrixWorldNeedsUpdate' does not exist o... Remove this comment to see the full error message
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

  addToScene(scene: typeof THREE.Scene) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'add' does not exist on type 'typeof Scen... Remove this comment to see the full error message
    scene.add(this.mesh);
  }

  createMesh() {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'radius' implicitly has an 'any' type.
    const createCircle = (radius) => {
      const segments = 64;
      const material = new THREE.LineBasicMaterial({
        color: this.COLOR,
      });
      const geometry = new THREE.CircleGeometry(radius, segments);
      // Remove center vertex
      geometry.vertices.shift();
      return new THREE.LineLoop(geometry, material);
    };

    const outerCircle = createCircle(this.WIDTH / 2);
    const innerCircle = createCircle(4);
    const mesh = new THREE.Group();
    mesh.add(outerCircle);
    mesh.add(innerCircle);
    mesh.rotation.x = Math.PI;
    mesh.matrixAutoUpdate = false;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'doubleSided' does not exist on type 'Gro... Remove this comment to see the full error message
    mesh.doubleSided = true;
    return mesh;
  }
}

export default Crosshair;
