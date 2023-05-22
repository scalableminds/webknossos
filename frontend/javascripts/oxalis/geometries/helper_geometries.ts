import * as THREE from "three";
import { OrthoViews, Vector3 } from "oxalis/constants";
import ResizableBuffer from "libs/resizable_buffer";
import app from "app";
import { V3 } from "libs/mjs";
import Store from "oxalis/store";
import Dimensions from "oxalis/model/dimensions";
import { getBaseVoxel } from "oxalis/model/scaleinfo";

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

export class QuickSelectGeometry {
  color: THREE.Color;
  meshGroup: THREE.Group;
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

    const baseWidth = getBaseVoxel(Store.getState().dataset.dataSource.scale);
    const centerGeometry = new THREE.PlaneGeometry(baseWidth, baseWidth);
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: this.centerMarkerColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.centerMarker = new THREE.Mesh(centerGeometry, centerMaterial);

    this.meshGroup = new THREE.Group();
    this.meshGroup.add(this.rectangle);
    this.meshGroup.add(this.centerMarker);

    // There are three `visible` properties that are used for different
    // purposes:
    // - The mesh group visibility effectively controls both the actual
    //   rectangle and the center marker geometry. It is set in
    //   adaptVisibilityForRendering.
    // - The visibility property of the rectangle marks whether
    //   the rectangle does have a size > 0.
    // - The visibility of the center marker is set depending on
    //   whether the quick-select tool is used with or without
    //   the heuristic approach (only in that case, the center
    //   has a meaning).
    this.meshGroup.visible = false;
    this.rectangle.visible = false;
    this.centerMarker.visible = false;

    this.reset();
  }

  reset() {
    this.rectangle.material.color = this.color;
    this.centerMarker.material.color = this.centerMarkerColor;
  }

  setCenterMarkerVisibility(visible: boolean) {
    this.centerMarker.visible = visible;
  }

  rotateToViewport() {
    const { activeViewport } = Store.getState().viewModeData.plane;
    const { scale } = Store.getState().dataset.dataSource;
    const rotation = rotations[activeViewport];
    if (!rotation) {
      return;
    }

    this.rectangle.setRotationFromEuler(rotation);
    this.centerMarker.setRotationFromEuler(rotation);
    this.centerMarker.scale.copy(
      new THREE.Vector3(
        ...Dimensions.transDim(scale.map((el) => 1 / el) as Vector3, activeViewport),
      ),
    );
  }

  setColor(color: THREE.Color) {
    this.color = color;
    // Copy this.color into this.centerMarkerColor
    this.centerMarkerColor.copy(this.color);
    this.centerMarkerColor.offsetHSL(0.5, 0, 0);

    this.reset();
  }

  setCoordinates(startPosition: Vector3, endPosition: Vector3) {
    const { activeViewport } = Store.getState().viewModeData.plane;
    // Add a depth to the endPosition so that the extent of the geometry
    // will have a depth of 1. Note that the extent is only used to scale
    // the geometry. Since it is a plane, a depth scale factor of > 1 won't
    // extrude it.
    const endPositionWithDepth = V3.add(
      endPosition,
      Dimensions.transDim([0, 0, 1], activeViewport),
    );

    const centerPosition = V3.scale(V3.add(startPosition, endPosition), 0.5);
    const extentXYZ = V3.abs(V3.sub(endPositionWithDepth, startPosition));
    const extentUVW = Dimensions.transDim(extentXYZ, activeViewport);

    // Note that the third dimension's value will be adapted again
    // in adaptVisibilityForRendering.
    this.rectangle.position.set(...centerPosition);
    this.rectangle.scale.set(...extentUVW);
    this.rectangle.geometry.computeBoundingSphere();

    this.centerMarker.position.set(...centerPosition);

    // Hide the objects if the rectangle has size zero, so whenever
    // the quick select tool is not currently used to draw a rectangle.
    this.rectangle.visible = !V3.isEqual(endPosition, startPosition);

    app.vent.trigger("rerender");
  }

  adaptVisibilityForRendering(flycamPosition: Vector3, thirdDim: 0 | 1 | 2) {
    // Only show this geometry when the current viewport is exactly at the
    // right position (third dimension).
    this.meshGroup.visible =
      this.rectangle.visible &&
      Math.trunc(flycamPosition[thirdDim]) ===
        Math.trunc(this.rectangle.position.toArray()[thirdDim]);

    if (this.meshGroup.visible) {
      // If the group is visible, adapt the position's third dimension to
      // be exactly at the third dimension of the flycam. Otherwise,
      // the geometry might be invisible when the current position is
      // fractional.
      const pos = this.rectangle.position.toArray();
      pos[thirdDim] = flycamPosition[thirdDim];
      this.rectangle.position.set(...pos);
      this.centerMarker.position.set(...pos);
    }
  }

  getMeshGroup() {
    return this.meshGroup;
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
