// @flow
import * as THREE from "three";
import type { Vector3 } from "oxalis/constants";
import "oxalis/constants";
import ResizableBuffer from "libs/resizable_buffer";
import app from "app";
export const CONTOUR_COLOR_NORMAL = new THREE.Color(0x0000ff);
export const CONTOUR_COLOR_DELETE = new THREE.Color(0xff0000);

class ContourGeometry {
  color: typeof THREE.Color;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'edge' has no initializer and is not defi... Remove this comment to see the full error message
  edge: typeof THREE.Line;

  constructor() {
    // @ts-expect-error ts-migrate(2739) FIXME: Type 'Color' is missing the following properties f... Remove this comment to see the full error message
    this.color = CONTOUR_COLOR_NORMAL;
    this.createMeshes();
  }

  createMeshes() {
    const edgeGeometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(3), 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    edgeGeometry.setAttribute("position", positionAttribute);
    // @ts-expect-error ts-migrate(2739) FIXME: Type 'Line' is missing the following properties fr... Remove this comment to see the full error message
    this.edge = new THREE.Line(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        linewidth: 2,
      }),
    );
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'ty... Remove this comment to see the full error message
    this.edge.vertexBuffer = new ResizableBuffer(3, Float32Array);
    this.reset();
  }

  reset() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
    this.edge.material.color = this.color;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'ty... Remove this comment to see the full error message
    this.edge.vertexBuffer.clear();
    this.finalizeMesh(this.edge);
  }

  getMeshes() {
    return [this.edge];
  }

  addEdgePoint(pos: Vector3) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'ty... Remove this comment to see the full error message
    this.edge.vertexBuffer.push(pos);
    this.finalizeMesh(this.edge);
    app.vent.trigger("rerender");
  }

  finalizeMesh(mesh: typeof THREE.Line) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'geometry' does not exist on type 'typeof... Remove this comment to see the full error message
    if (mesh.geometry.attributes.position.array !== mesh.vertexBuffer.getBuffer()) {
      // Need to rebuild Geometry
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'ty... Remove this comment to see the full error message
      const positionAttribute = new THREE.BufferAttribute(mesh.vertexBuffer.getBuffer(), 3);
      positionAttribute.setUsage(THREE.DynamicDrawUsage);
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'geometry' does not exist on type 'typeof... Remove this comment to see the full error message
      mesh.geometry.dispose();
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'geometry' does not exist on type 'typeof... Remove this comment to see the full error message
      mesh.geometry.setAttribute("position", positionAttribute);
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'geometry' does not exist on type 'typeof... Remove this comment to see the full error message
    mesh.geometry.attributes.position.needsUpdate = true;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'geometry' does not exist on type 'typeof... Remove this comment to see the full error message
    mesh.geometry.setDrawRange(0, mesh.vertexBuffer.getLength());
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'geometry' does not exist on type 'typeof... Remove this comment to see the full error message
    mesh.geometry.computeBoundingSphere();
  }
}

export default ContourGeometry;
