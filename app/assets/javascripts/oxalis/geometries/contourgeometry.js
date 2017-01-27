import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import ResizableBuffer from "libs/resizable_buffer";
import * as THREE from "three";

const COLOR_NORMAL = new THREE.Color(0x0000ff);
const COLOR_DELETE = new THREE.Color(0xff0000);


class ContourGeometry {

  constructor(volumeTracing, flycam) {
    this.volumeTracing = volumeTracing;
    this.flycam = flycam;
    _.extend(this, Backbone.Events);

    this.color = COLOR_NORMAL;

    this.listenTo(this.volumeTracing, "volumeAnnotated", this.reset);
    this.listenTo(this.volumeTracing, "updateLayer", function (cellId, contourList) {
      this.color = cellId === 0 ? COLOR_DELETE : COLOR_NORMAL;
      this.reset();
      contourList.forEach(p =>
        this.addEdgePoint(p));
    });

    this.createMeshes();
  }


  createMeshes() {
    const edgeGeometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(), 3);
    positionAttribute.setDynamic(true);
    edgeGeometry.addAttribute("position", positionAttribute);

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
    this.edge.vertexBuffer.push(pos);
    this.finalizeMesh(this.edge);

    app.vent.trigger("rerender");
  }


  finalizeMesh(mesh) {
    if (mesh.geometry.attributes.position.array !== mesh.vertexBuffer.getBuffer()) {
      // Need to rebuild Geometry
      const positionAttribute = new THREE.BufferAttribute(mesh.vertexBuffer.getBuffer(), 3);
      positionAttribute.setDynamic(true);

      mesh.geometry.dispose();
      mesh.geometry.addAttribute("position", positionAttribute);
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.setDrawRange(0, mesh.vertexBuffer.getLength());
    mesh.geometry.computeBoundingSphere();
  }
}

export default ContourGeometry;
