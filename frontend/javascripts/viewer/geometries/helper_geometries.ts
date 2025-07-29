import app from "app";
import { V3 } from "libs/mjs";
import ResizableBuffer from "libs/resizable_buffer";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  Vector3 as ThreeVector3,
  Vector2,
} from "three";
import { type OrthoView, OrthoViews, type Vector3 } from "viewer/constants";
import Dimensions from "viewer/model/dimensions";
import { getBaseVoxelInUnit } from "viewer/model/scaleinfo";
import Store from "viewer/store";

export const CONTOUR_COLOR_NORMAL = new Color(0x0000ff);
export const CONTOUR_COLOR_DELETE = new Color(0xff0000);

export class ContourGeometry {
  color: Color;
  line: Line<BufferGeometry, LineBasicMaterial>;
  connectingLine: Line<BufferGeometry, LineBasicMaterial>;
  vertexBuffer: ResizableBuffer<Float32Array>;
  connectingLinePositions: Float32Array;
  viewport: OrthoView;
  showConnectingLine: boolean;

  constructor(showConnectingLine: boolean = false) {
    this.color = CONTOUR_COLOR_NORMAL;
    this.viewport = OrthoViews.PLANE_XY;
    this.showConnectingLine = showConnectingLine;

    const edgeGeometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(new Float32Array(3), 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    edgeGeometry.setAttribute("position", positionAttribute);
    this.line = new Line(
      edgeGeometry,
      new LineBasicMaterial({
        linewidth: 2,
      }),
    );
    const connectingLineGeometry = new BufferGeometry();
    this.connectingLinePositions = new Float32Array(6);
    const connectingLinePositionAttribute = new BufferAttribute(this.connectingLinePositions, 3);
    connectingLinePositionAttribute.setUsage(DynamicDrawUsage);
    connectingLineGeometry.setAttribute("position", connectingLinePositionAttribute);
    positionAttribute.setUsage(DynamicDrawUsage);
    this.connectingLine = new Line(
      connectingLineGeometry,
      new LineBasicMaterial({
        linewidth: 2,
      }),
    );
    this.vertexBuffer = new ResizableBuffer(3, Float32Array);
    this.connectingLine.visible = false;
    this.reset();
  }

  reset() {
    this.viewport = OrthoViews.PLANE_XY;
    this.line.material.color = this.color;
    this.connectingLine.material.color = new Color(0x00ffff);
    this.vertexBuffer.clear();
    this.connectingLinePositions.fill(0);
    this.finalizeMesh();
  }

  setViewport(viewport: OrthoView) {
    this.viewport = viewport;
  }

  getMeshes() {
    return [this.line, this.connectingLine];
  }

  addEdgePoint(pos: Vector3) {
    const pointCount = this.vertexBuffer.getLength();
    const lastPoint = this.vertexBuffer.getBuffer().subarray((pointCount - 1) * 3, pointCount * 3);
    if (V3.equals(pos, lastPoint)) {
      // Skip adding the point if it is the same as the last one.
      return;
    }
    this.vertexBuffer.push(pos);
    const startPoint = this.vertexBuffer.getBuffer().subarray(0, 3);
    // Setting start and end point to form the connecting line.
    this.connectingLinePositions.set(startPoint, 0);
    this.connectingLinePositions.set(pos, 3);
    this.finalizeMesh();
    app.vent.emit("rerender");
  }

  connectToStartPoint() {
    const pointCount = this.vertexBuffer.getLength();
    if (pointCount < 1) {
      return;
    }
    const startPoint = this.vertexBuffer.getBuffer().subarray(0, 3);
    this.vertexBuffer.push(startPoint);
    // Hide the connection line upon completing the contour.
    this.connectingLine.visible = false;
    this.finalizeMesh();
    app.vent.emit("rerender");
  }

  finalizeMesh() {
    const mesh = this.line;
    if (mesh.geometry.attributes.position.array !== this.vertexBuffer.getBuffer()) {
      // Need to rebuild Geometry
      const positionAttribute = new BufferAttribute(this.vertexBuffer.getBuffer(), 3);
      positionAttribute.setUsage(DynamicDrawUsage);
      mesh.geometry.dispose();
      mesh.geometry.setAttribute("position", positionAttribute);
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.setDrawRange(0, this.vertexBuffer.getLength());
    mesh.geometry.computeBoundingSphere();
    this.connectingLine.geometry.attributes.position.needsUpdate = true;
    this.connectingLine.geometry.computeBoundingSphere();
  }

  getArea(voxelSizeFactor: Vector3): number {
    // This algorithm is based on the Trapezoid formula for calculating the polygon area.
    // Source: https://www.mathopenref.com/coordpolygonarea2.html.
    let accAreaInUnit = 0;
    const pointCount = this.vertexBuffer.getLength();
    const points = this.vertexBuffer.getBuffer();
    let previousPointIndex = pointCount - 1;
    const dimIndices = Dimensions.getIndices(this.viewport);
    const scaleVector = new Vector2(voxelSizeFactor[dimIndices[0]], voxelSizeFactor[dimIndices[1]]);
    for (let i = 0; i < pointCount; i++) {
      const start = new Vector2(
        points[previousPointIndex * 3 + dimIndices[0]],
        points[previousPointIndex * 3 + dimIndices[1]],
      ).multiply(scaleVector);
      const end = new Vector2(
        points[i * 3 + dimIndices[0]],
        points[i * 3 + dimIndices[1]],
      ).multiply(scaleVector);
      accAreaInUnit += (start.x + end.x) * (start.y - end.y);
      previousPointIndex = i;
    }
    return Math.abs(accAreaInUnit / 2);
  }
  hide() {
    this.line.visible = false;
    this.connectingLine.visible = false;
  }
  resetAndHide() {
    this.reset();
    this.hide();
  }
  show() {
    this.line.visible = true;
    if (this.showConnectingLine) {
      this.connectingLine.visible = true;
    }
  }
}

const rotations = {
  [OrthoViews.PLANE_XY]: new Euler(0, 0, 0),
  [OrthoViews.PLANE_YZ]: new Euler(Math.PI, -(1 / 2) * Math.PI, Math.PI),
  [OrthoViews.PLANE_XZ]: new Euler((1 / 2) * Math.PI, 0, 0),
  [OrthoViews.TDView]: null,
};

export class QuickSelectGeometry {
  color: Color;
  meshGroup: Group;
  centerMarkerColor: Color;
  rectangle: Mesh<PlaneGeometry, MeshBasicMaterial>;
  centerMarker: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor() {
    this.color = CONTOUR_COLOR_NORMAL;
    this.centerMarkerColor = new Color(0xff00ff);

    const geometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicMaterial({
      side: DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    this.rectangle = new Mesh(geometry, material);

    const baseWidth = getBaseVoxelInUnit(Store.getState().dataset.dataSource.scale.factor);
    const centerGeometry = new PlaneGeometry(baseWidth, baseWidth);
    const centerMaterial = new MeshBasicMaterial({
      color: this.centerMarkerColor,
      side: DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.centerMarker = new Mesh(centerGeometry, centerMaterial);

    this.meshGroup = new Group();
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
    const { factor: scaleFactor } = Store.getState().dataset.dataSource.scale;
    const rotation = rotations[activeViewport];
    if (!rotation) {
      return;
    }

    this.rectangle.setRotationFromEuler(rotation);
    this.centerMarker.setRotationFromEuler(rotation);
    this.centerMarker.scale.copy(
      new ThreeVector3(
        ...Dimensions.transDim(scaleFactor.map((el) => 1 / el) as Vector3, activeViewport),
      ),
    );
  }

  setColor(color: Color) {
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

    app.vent.emit("rerender");
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
    const texture = new DataTexture(ndData, width, height, RGBAFormat);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
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

// This class is used to display connected line segments and is used by the LineMeasurementTool.
export class LineMeasurementGeometry {
  color: Color;
  line: Line<BufferGeometry, LineBasicMaterial>;
  vertexBuffer: ResizableBuffer<Float32Array>;
  viewport: OrthoView;
  visible: boolean;
  wasReset: boolean;

  constructor() {
    this.wasReset = false;
    this.viewport = OrthoViews.PLANE_XY;
    this.color = CONTOUR_COLOR_NORMAL;
    this.visible = false;

    const lineGeometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(new Float32Array(3), 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    lineGeometry.setAttribute("position", positionAttribute);
    this.line = new Line(
      lineGeometry,
      new LineBasicMaterial({
        linewidth: 2,
      }),
    );
    this.line.visible = false;
    this.line.material.color = this.color;
    this.vertexBuffer = new ResizableBuffer(3, Float32Array);
    this.finalizeMesh();
  }

  getMeshes() {
    return [this.line];
  }

  reset() {
    this.line.material.color = this.color;
    this.vertexBuffer.clear();
    this.finalizeMesh();
    this.wasReset = true;
  }

  setStartPoint(pos: Vector3, initialOrthoView: OrthoView) {
    this.vertexBuffer.clear();
    this.wasReset = false;
    this.visible = true;
    this.viewport = initialOrthoView;
    this.vertexBuffer.push(pos);
    // Adding an additional point that will be modified by updateLatestPointPosition.
    this.vertexBuffer.push(pos);
    this.finalizeMesh();
  }

  // This method updates the latest point of the connected line segments.
  // The main purpose of this method to let the latest point follow the mouse pointer.
  updateLatestPointPosition(pos: Vector3) {
    const pointCount = this.vertexBuffer.getLength();
    this.vertexBuffer.set(pos, pointCount - 1);
    this.finalizeMesh();
  }

  addPoint(pos: Vector3) {
    this.updateLatestPointPosition(pos);
    this.vertexBuffer.push(pos);
    this.finalizeMesh();
  }

  hide() {
    this.visible = false;
  }

  resetAndHide() {
    this.reset();
    this.hide();
  }

  finalizeMesh() {
    const mesh = this.line;
    if (mesh.geometry.attributes.position.array !== this.vertexBuffer.getBuffer()) {
      // Need to rebuild Geometry
      const positionAttribute = new BufferAttribute(this.vertexBuffer.getBuffer(), 3);
      positionAttribute.setUsage(DynamicDrawUsage);
      mesh.geometry.dispose();
      mesh.geometry.setAttribute("position", positionAttribute);
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.setDrawRange(0, this.vertexBuffer.getLength());
    mesh.geometry.computeBoundingSphere();
    app.vent.emit("rerender");
  }

  getDistance(voxelSizeFactor: Vector3): number {
    const scaleVector = new ThreeVector3(...voxelSizeFactor);
    const points = this.vertexBuffer.getBuffer();
    const pointCount = this.vertexBuffer.getLength();
    if (pointCount < 2) {
      return 0;
    }
    let accDistanceInUnit = 0;
    for (let i = 0; i < pointCount - 1; i++) {
      const start = new ThreeVector3(...points.subarray(i * 3, (i + 1) * 3)).multiply(scaleVector);
      const end = new ThreeVector3(...points.subarray((i + 1) * 3, (i + 2) * 3)).multiply(
        scaleVector,
      );
      accDistanceInUnit += start.distanceTo(end);
    }
    return accDistanceInUnit;
  }

  updateForCam(orthoView: OrthoView) {
    if (orthoView === this.viewport && this.visible) {
      this.line.visible = true;
    } else {
      this.line.visible = false;
    }
  }
}
