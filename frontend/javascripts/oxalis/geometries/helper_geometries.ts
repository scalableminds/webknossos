import * as THREE from "three";
import { OrthoViews, Vector3 } from "oxalis/constants";
import ResizableBuffer from "libs/resizable_buffer";
import app from "app";
import { V3 } from "libs/mjs";
import Store from "oxalis/store";
import Dimensions from "oxalis/model/dimensions";
import shaderEditor from "oxalis/model/helpers/shader_editor";

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

export class RectangleGeometry {
  color: THREE.Color;
  centerMarkerColor: THREE.Color;
  rectangle: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  borderRing: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
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

    const centerGeometry = new THREE.PlaneGeometry(2, 2);
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: this.centerMarkerColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.centerMarker = new THREE.Mesh(centerGeometry, centerMaterial);

    this.borderRing = this.createBorderMesh();

    this.reset();
  }

  createBorderMesh() {
    // Inspired by https://jsfiddle.net/felixmariotto/ozds3yxa/16/

    const vertexShader = `
      precision highp float;

      varying vec4 worldCoord;
      varying vec4 modelCoord;
      varying vec2 vUv;
      varying mat4 savedModelMatrix;

      void main() {
        vUv = uv;
        modelCoord = vec4(position, 1.0);
        savedModelMatrix = modelMatrix;
        worldCoord = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      varying vec4 vPos;
      varying vec3 vNormal;
      varying vec2 vUv;

      uniform float borderWidth;
      uniform vec2 sizeRaw;
      uniform vec3 color;
      uniform vec3 borderColor;

      float getEdgeDist() {
        vec2 size = vec2(1., 1.);
        vec2 ndc = vec2( vUv.x * 2.0 - 1.0, vUv.y * 2.0 - 1.0 );

        vec2 planeSpaceCoord = vec2( size.x * 0.5 * ndc.x, size.y * 0.5 * ndc.y );
        vec2 corner = size * 0.5;
        vec2 offsetCorner = corner - abs( planeSpaceCoord );
        float innerRadDist = min( offsetCorner.x, offsetCorner.y ) * -1.0;

        return innerRadDist;
      }

      void main() {
        float edgeDist = getEdgeDist() ;
        if ( edgeDist > 0.0 ) discard;
        if ( edgeDist * -1.0 >= 4. * fwidth(edgeDist) ) discard;
        gl_FragColor = vec4( borderColor, 1. );
      }

    `;

    const rectSize = new THREE.Vector2(1, 1);

    const uniforms = {
      borderRadius: { value: 0 },
      size: { value: rectSize },
      borderColor: { value: new THREE.Color("orange") },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    });
    shaderEditor.addMaterial("border", material);
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rectSize.x, rectSize.y), material);
    return mesh;
  }

  reset() {
    this.rectangle.material.color = this.color;
    this.centerMarker.material.color = this.centerMarkerColor;
    // this.borderRing.material.color = this.centerMarkerColor;
  }

  rotateToViewport() {
    const { activeViewport } = Store.getState().viewModeData.plane;
    const rotation = rotations[activeViewport];
    if (!rotation) {
      return;
    }

    this.rectangle.setRotationFromEuler(rotation);
    this.centerMarker.setRotationFromEuler(rotation);
    this.borderRing.setRotationFromEuler(rotation);
  }

  setColor(color: THREE.Color) {
    this.color = color;
    // this.color.offsetHSL(0.0, 0, -0.3);
    // Copy this.color into this.centerMarkerColor
    this.centerMarkerColor.copy(this.color);
    this.centerMarkerColor.offsetHSL(0.5, 0, 0);

    this.reset();
  }

  setCoordinates(startPosition: Vector3, endPosition: Vector3) {
    const centerPosition = V3.scale(V3.add(startPosition, endPosition), 0.5);
    const extentXYZ = V3.abs(V3.sub(endPosition, startPosition));
    const { activeViewport } = Store.getState().viewModeData.plane;
    const extentUVW = Dimensions.transDim(extentXYZ, activeViewport);
    extentUVW[2] = 2;

    this.rectangle.position.set(...centerPosition);
    this.rectangle.scale.set(...extentUVW);
    this.rectangle.geometry.computeBoundingSphere();

    this.centerMarker.position.set(...centerPosition);

    this.borderRing.position.set(...centerPosition);
    this.borderRing.scale.set(...extentUVW);

    this.borderRing.material.uniforms.size.value.set(extentUVW[0], extentUVW[1]);

    app.vent.trigger("rerender");
  }

  getMeshes() {
    return [this.rectangle, this.centerMarker, this.borderRing];
  }

  attachData(ndData: Uint8Array, width: number, height: number) {
    const texture = new THREE.DataTexture(ndData, width, height, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;

    const rectangle = this.rectangle;
    rectangle.material.alphaMap = texture;
    rectangle.material.needsUpdate = true;
  }

  unattachTexture() {
    const rectangle = this.rectangle;
    rectangle.material.alphaMap = null;
  }
}
