/**
 * contourgeometry.js
 * @flow
 */

import * as THREE from "three";

import { type Vector3 } from "oxalis/constants";
import ResizableBuffer from "libs/resizable_buffer";
import app from "app";

export const CONTOUR_COLOR_NORMAL = new THREE.Color(0x0000ff);
export const CONTOUR_COLOR_DELETE = new THREE.Color(0xff0000);

class ContourGeometry {
  color: typeof THREE.Color;
  edge: typeof THREE.Line;

  constructor() {
    this.color = CONTOUR_COLOR_NORMAL;
    this.createMeshes();
  }

  createMeshes() {
    const edgeGeometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(3), 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    edgeGeometry.setAttribute("position", positionAttribute);

    this.edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({ linewidth: 2 }));
    this.edge.vertexBuffer = new ResizableBuffer(3, Float32Array);

    this.reset();
  }

  reset() {
    this.edge.material.color = this.color;
    this.edge.vertexBuffer.clear();
    this.finalizeMesh(this.edge);
  }

  getMeshes() {
    return [this.edge];
  }

  addEdgePoint(pos: Vector3) {
    this.edge.vertexBuffer.push(pos);
    this.finalizeMesh(this.edge);

    app.vent.trigger("rerender");
  }

  finalizeMesh(mesh: typeof THREE.Line) {
    if (mesh.geometry.attributes.position.array !== mesh.vertexBuffer.getBuffer()) {
      // Need to rebuild Geometry
      const positionAttribute = new THREE.BufferAttribute(mesh.vertexBuffer.getBuffer(), 3);
      positionAttribute.setUsage(THREE.DynamicDrawUsage);

      mesh.geometry.dispose();
      mesh.geometry.setAttribute("position", positionAttribute);
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.setDrawRange(0, mesh.vertexBuffer.getLength());
    mesh.geometry.computeBoundingSphere();
  }
}

export default ContourGeometry;
