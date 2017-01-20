import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import ResizableBuffer from "libs/resizable_buffer";
import * as THREE from "three";

class ContourGeometry {
  static initClass() {
    this.prototype.COLOR_NORMAL = new THREE.Color(0x0000ff);
    this.prototype.COLOR_DELETE = new THREE.Color(0xff0000);
  }

  constructor(volumeTracing, flycam) {
    this.volumeTracing = volumeTracing;
    this.flycam = flycam;
    _.extend(this, Backbone.Events);

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
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(), 3);
    positionAttribute.setDynamic(true);
    edgeGeometry.addAttribute( 'position', positionAttribute);

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
    // pos might be integer, but the third dimension needs to be exact.
    const globalPos = this.flycam.getPosition();
    const edgePoint = pos.slice();
    edgePoint[this.thirdDimension] = globalPos[this.thirdDimension];

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
ContourGeometry.initClass();

export default ContourGeometry;
