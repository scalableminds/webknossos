import * as THREE from "three";
import { OrthoViews, Vector3 } from "oxalis/constants";
import ResizableBuffer from "libs/resizable_buffer";
import app from "app";
import { V3 } from "libs/mjs";
import Store from "oxalis/store";
import Dimensions from "oxalis/model/dimensions";

export const CONTOUR_COLOR_NORMAL = new THREE.Color(0x0000ff);
export const CONTOUR_COLOR_DELETE = new THREE.Color(0xff0000);

export class ContourGeometry {
  color: THREE.Color;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  vertexBuffer: ResizableBuffer<Float32Array>;

  constructor() {
    this.color = CONTOUR_COLOR_NORMAL;

    const edgeGeometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(3), 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    edgeGeometry.setAttribute("position", positionAttribute);
    this.line = new THREE.Line(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        linewidth: 2,
      }),
    );
    this.vertexBuffer = new ResizableBuffer(3, Float32Array);
    this.reset();
  }

  reset() {
    this.line.material.color = this.color;
    this.vertexBuffer.clear();
    this.finalizeMesh();
  }

  getMeshes() {
    return [this.line];
  }

  addEdgePoint(pos: Vector3) {
    this.vertexBuffer.push(pos);
    this.finalizeMesh();
    app.vent.trigger("rerender");
  }

  finalizeMesh() {
    const mesh = this.line;
    if (mesh.geometry.attributes.position.array !== this.vertexBuffer.getBuffer()) {
      // Need to rebuild Geometry
      const positionAttribute = new THREE.BufferAttribute(this.vertexBuffer.getBuffer(), 3);
      positionAttribute.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.dispose();
      mesh.geometry.setAttribute("position", positionAttribute);
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.setDrawRange(0, this.vertexBuffer.getLength());
    mesh.geometry.computeBoundingSphere();
  }
}

const rotations = {
  [OrthoViews.PLANE_XY]: new THREE.Euler(0, 0, 0),
  [OrthoViews.PLANE_YZ]: new THREE.Euler(Math.PI, -(1 / 2) * Math.PI, Math.PI),
  [OrthoViews.PLANE_XZ]: new THREE.Euler((1 / 2) * Math.PI, 0, 0),
  [OrthoViews.TDView]: null,
};

export class RectangleGeometry {
  color: THREE.Color;
  centerMarkerColor: THREE.Color;
  rectangle: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  centerMarker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    this.color = CONTOUR_COLOR_NORMAL;
    this.centerMarkerColor = new THREE.Color(0xff00ff);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    this.rectangle = new THREE.Mesh(geometry, material);

    const centerGeometry = new THREE.PlaneGeometry(2, 2);
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: this.centerMarkerColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.centerMarker = new THREE.Mesh(centerGeometry, centerMaterial);

    this.reset();
  }

  reset() {
    this.rectangle.material.color = this.color;
    this.centerMarker.material.color = this.centerMarkerColor;
  }

  rotateToViewport() {
    const { activeViewport } = Store.getState().viewModeData.plane;
    const rotation = rotations[activeViewport];
    if (!rotation) {
      return;
    }

    this.rectangle.setRotationFromEuler(rotation);
    this.centerMarker.setRotationFromEuler(rotation);
  }

  setColor(color: THREE.Color) {
    this.color = color;
    // Copy this.color into this.centerMarkerColor
    this.centerMarkerColor.copy(this.color);
    this.centerMarkerColor.offsetHSL(0.5, 0, 0);

    this.reset();
  }

  setCoordinates(startPosition: Vector3, endPosition: Vector3) {
    const centerPosition = V3.scale(V3.add(startPosition, endPosition), 0.5);
    const extentXYZ = V3.abs(V3.sub(endPosition, startPosition));
    const { activeViewport } = Store.getState().viewModeData.plane;
    const extentUVW = Dimensions.transDim(extentXYZ, activeViewport);
    extentUVW[2] = 2;

    this.rectangle.position.set(...centerPosition);
    this.rectangle.scale.set(...extentUVW);
    this.rectangle.geometry.computeBoundingSphere();

    this.centerMarker.position.set(...centerPosition);

    app.vent.trigger("rerender");
  }

  getMeshes() {
    return [this.rectangle, this.centerMarker];
  }

  attachTextureMask(ndData: Uint8Array, width: number, height: number) {
    // Attach the array as a binary mask so that the rectangle preview
    // is only rendered where the passed array is 1.
    const texture = new THREE.DataTexture(ndData, width, height, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;

    const rectangle = this.rectangle;
    rectangle.material.alphaMap = texture;
    rectangle.material.needsUpdate = true;
  }

  detachTextureMask() {
    // Detach the texture mask, so that the full rectangle is visible again
    // (important while drawing the rectangle).
    const rectangle = this.rectangle;
    rectangle.material.alphaMap = null;
  }
}
