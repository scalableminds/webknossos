/**
 * contourgeometry.js
 * @flow
 */

import * as THREE from "three";

import { ContourModeEnum, type Vector3 } from "oxalis/constants";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { isTraceTool } from "oxalis/model/accessors/tool_accessor";
import ResizableBuffer from "libs/resizable_buffer";
import Store from "oxalis/store";
import app from "app";

const COLOR_NORMAL = new THREE.Color(0x0000ff);
const COLOR_DELETE = new THREE.Color(0xff0000);

class ContourGeometry {
  color: typeof THREE.Color;
  edge: typeof THREE.Line;

  constructor() {
    this.color = COLOR_NORMAL;

    getVolumeTracing(Store.getState().tracing).map(initialTracing => {
      let lastContourList = initialTracing.contourList;

      Store.subscribe(() => {
        const { tracing, uiInformation } = Store.getState();
        getVolumeTracing(tracing).map(volumeTracing => {
          if (isTraceTool(uiInformation.activeTool)) {
            const contourList = volumeTracing.contourList;
            if (contourList && lastContourList.length !== contourList.length) {
              // Update meshes according to the new contourList
              this.reset();
              this.color =
                volumeTracing.contourTracingMode === ContourModeEnum.DELETE
                  ? COLOR_DELETE
                  : COLOR_NORMAL;
              contourList.forEach(p => this.addEdgePoint(p));
            }
            lastContourList = contourList;
          }
        });
      });
    });

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
