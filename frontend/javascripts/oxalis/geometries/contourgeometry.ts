import * as THREE from "three";
import type { Vector3 } from "oxalis/constants";
import ResizableBuffer from "libs/resizable_buffer";
import app from "app";
import { V3 } from "libs/mjs";

export const CONTOUR_COLOR_NORMAL = new THREE.Color(0x0000ff);
export const CONTOUR_COLOR_DELETE = new THREE.Color(0xff0000);

class ContourGeometry {
  color: THREE.Color;
  line: THREE.Line;

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
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'Li... Remove this comment to see the full error message
    this.line.vertexBuffer = new ResizableBuffer(3, Float32Array);
    this.reset();
  }

  reset() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'color' does not exist on type 'Material ... Remove this comment to see the full error message
    this.line.material.color = this.color;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'Li... Remove this comment to see the full error message
    this.line.vertexBuffer.clear();
    this.finalizeMesh(this.line);
  }

  getMeshes() {
    return [this.line];
  }

  addEdgePoint(pos: Vector3) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vertexBuffer' does not exist on type 'Li... Remove this comment to see the full error message
    this.line.vertexBuffer.push(pos);
    this.finalizeMesh(this.line);
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
      mesh.geometry.setAttribute("position", positionAttribute);
    }

    mesh.geometry.attributes.position.needsUpdate = true;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setDrawRange' does not exist on type 'Bu... Remove this comment to see the full error message
    mesh.geometry.setDrawRange(0, mesh.vertexBuffer.getLength());
    mesh.geometry.computeBoundingSphere();
  }
}

export class RectangleGeometry {
  color: THREE.Color;
  plane: THREE.Mesh;
  centerMarker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;

  constructor() {
    this.color = CONTOUR_COLOR_NORMAL;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshLambertMaterial({
      // color: 0xffff00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    this.plane = new THREE.Mesh(geometry, material);

    const centerGeometry = new THREE.PlaneGeometry(2, 2);
    const centerMaterial = new THREE.MeshLambertMaterial({
      color: 0xff00ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.centerMarker = new THREE.Mesh(centerGeometry, centerMaterial);

    this.reset();
  }

  reset() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'color' does not exist on type 'Material ... Remove this comment to see the full error message
    this.plane.material.color = this.color;
  }

  setCoordinates(startPosition: Vector3, endPosition: Vector3) {
    const position = V3.scale(V3.add(startPosition, endPosition), 0.5);
    const extent = V3.abs(V3.sub(endPosition, startPosition));
    this.plane.position.set(...position);
    this.plane.scale.set(extent[0], extent[1], 1);
    this.plane.geometry.computeBoundingSphere();
    this.centerMarker.position.set(...position);
    app.vent.trigger("rerender");
  }

  getMeshes() {
    return [this.plane, this.centerMarker];
  }

  attachData(ndData: Uint8Array, width: number, height: number) {
    const texture = new THREE.DataTexture(ndData, width, height, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;

    // Even though this.plane should have exactly this type, the unpacking is still necessary
    // for TS to understand that material is not an array.
    const plane = this.plane as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
    plane.material.alphaMap = texture;
    plane.material.needsUpdate = true;
  }

  unattachTexture() {
    // Even though this.plane should have exactly this type, the unpacking is still necessary
    // for TS to understand that material is not an array.
    const plane = this.plane as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
    plane.material.alphaMap = null;
  }
}

export default ContourGeometry;
