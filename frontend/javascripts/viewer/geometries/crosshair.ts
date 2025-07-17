import {
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Scene,
  Vector3,
} from "three";
import { getZoomedMatrix } from "viewer/model/accessors/flycam_accessor";
import Store from "viewer/store";

class Crosshair {
  mesh: Group;
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
    this.mesh = this.createMesh();
    this.setScale(scale);
  }

  setVisibility(v: boolean) {
    this.mesh.visible = v;
  }

  update() {
    const { mesh } = this;
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
    mesh.matrix.multiply(new Matrix4().makeRotationY(Math.PI));
    mesh.matrix.multiply(new Matrix4().makeTranslation(0, 0, 0.5));
    mesh.matrix.scale(new Vector3(this.scale, this.scale, this.scale));
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

  addToScene(scene: Scene) {
    scene.add(this.mesh);
  }

  createMesh(): Group {
    const createCircle = (radius: number) => {
      const geometry = new RingGeometry(radius, radius + 4, 64);
      const material = new MeshBasicMaterial({ color: this.COLOR, side: DoubleSide });
      return new Mesh(geometry, material);
    };

    const outerCircle = createCircle(this.WIDTH / 2);
    const innerCircle = createCircle(4);
    const mesh = new Group();

    mesh.add(outerCircle);
    mesh.add(innerCircle);
    mesh.rotation.x = Math.PI;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

export default Crosshair;
