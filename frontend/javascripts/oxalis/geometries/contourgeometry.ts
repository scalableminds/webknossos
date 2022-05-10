import * as THREE from "three";
import type { Vector3 } from "oxalis/constants";
import ResizableBuffer from "libs/resizable_buffer";
import app from "app";
export const CONTOUR_COLOR_NORMAL = new THREE.Color(0x0000ff);
export const CONTOUR_COLOR_DELETE = new THREE.Color(0xff0000);

class ContourGeometry {
  color: THREE.Color;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'edge' has no initializer and is not defi... Remove this comment to see the full error message
  edge: THREE.Line;

  constructor() {
    this.color = CONTOUR_COLOR_NORMAL;
    this.createMeshes();
  }

  createMeshes() {
    const edgeGeometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(3), 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    edgeGeometry.setAttribute("position", positionAttribute);
    this.edge = new THREE.Line(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        linewidth: 2,
      }),
    );
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'Li... Remove this comment to see the full error message
    this.edge.vertexBuffer = new ResizableBuffer(3, Float32Array);
    this.reset();
  }

  reset() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'color' does not exist on type 'Material ... Remove this comment to see the full error message
    this.edge.material.color = this.color;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'Li... Remove this comment to see the full error message
    this.edge.vertexBuffer.clear();
    this.finalizeMesh(this.edge);
  }

  getMeshes() {
    return [this.edge];
  }

  addEdgePoint(pos: Vector3) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'Li... Remove this comment to see the full error message
    this.edge.vertexBuffer.push(pos);
    this.finalizeMesh(this.edge);
    app.vent.trigger("rerender");
  }

  finalizeMesh(mesh: THREE.Line) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'attributes' does not exist on type 'Buff... Remove this comment to see the full error message
    if (mesh.geometry.attributes.position.array !== mesh.vertexBuffer.getBuffer()) {
      // Need to rebuild Geometry
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'Li... Remove this comment to see the full error message
      const positionAttribute = new THREE.BufferAttribute(mesh.vertexBuffer.getBuffer(), 3);
      positionAttribute.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.dispose();
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setAttribute' does not exist on type 'Bu... Remove this comment to see the full error message
      mesh.geometry.setAttribute("position", positionAttribute);
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'attributes' does not exist on type 'Buff... Remove this comment to see the full error message
    mesh.geometry.attributes.position.needsUpdate = true;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setDrawRange' does not exist on type 'Bu... Remove this comment to see the full error message
    mesh.geometry.setDrawRange(0, mesh.vertexBuffer.getLength());
    mesh.geometry.computeBoundingSphere();
  }
}

export default ContourGeometry;
