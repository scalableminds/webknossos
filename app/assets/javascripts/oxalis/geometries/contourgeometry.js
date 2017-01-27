/**
 * contourgeometry.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import ResizableBuffer from "libs/resizable_buffer";
import THREE from "three";
import VolumeTracing from "oxalis/model/volumetracing/volumetracing";
import Flycam2d from "oxalis/model/flycam2d";

class ContourGeometry {
  volumeTracing: VolumeTracing;
  flycam: Flycam2d;
  color: THREE.Color;
  COLOR_NORMAL: THREE.Color;
  COLOR_DELETE: THREE.Color;
  edge: THREE.Line;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(volumeTracing: VolumeTracing, flycam: Flycam2d) {
    this.volumeTracing = volumeTracing;
    this.flycam = flycam;
    _.extend(this, Backbone.Events);

    this.COLOR_NORMAL = new THREE.Color(0x0000ff);
    this.COLOR_DELETE = new THREE.Color(0xff0000);
    this.color = this.COLOR_NORMAL;

    this.listenTo(this.volumeTracing, "volumeAnnotated", this.reset);
    this.listenTo(this.volumeTracing, "updateLayer", function (cellId, contourList) {
      this.color = cellId === 0 ? this.COLOR_DELETE : this.COLOR_NORMAL;
      this.reset();
      contourList.forEach(p =>
        this.addEdgePoint(p));
    });

    this.createMeshes();
  }


  createMeshes() {
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.addAttribute("position", Float32Array, 0, 3);
    edgeGeometry.dynamic = true;

    this.edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({ linewidth: 2 }), THREE.LineStrip);
    this.edge.vertexBuffer = new ResizableBuffer(3);

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


  addEdgePoint(pos) {
    const edgePoint = pos.slice();
    this.edge.vertexBuffer.push(edgePoint);
    this.finalizeMesh(this.edge);

    app.vent.trigger("rerender");
  }


  finalizeMesh(mesh) {
    const positionAttribute = mesh.geometry.attributes.position;

    positionAttribute.array = mesh.vertexBuffer.getBuffer();
    positionAttribute.numItems = mesh.vertexBuffer.getLength() * 3;
    positionAttribute.needsUpdate = true;
  }
}

export default ContourGeometry;
