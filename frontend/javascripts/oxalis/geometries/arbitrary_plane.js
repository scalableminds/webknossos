/**
 * arbitrary_plane.js
 * @flow
 */
import * as THREE from "three";
import _ from "lodash";

import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Store from "oxalis/store";
import constants, { OrthoViews, type Vector4 } from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import shaderEditor from "oxalis/model/helpers/shader_editor";

// Let's set up our trianglesplane.
// It serves as a "canvas" where the brain images
// are drawn.
// Don't let the name fool you, this is just an
// ordinary plane with a texture applied to it.
//
// User tests showed that looking a bend surface (a half sphere)
// feels more natural when moving around in 3D space.
// To acknowledge this fact we determine the pixels that will
// be displayed by requesting them as though they were
// attached to bend surface.
// The result is then projected on a flat surface.

const renderDebuggerPlane = false;

type ArbitraryMeshes = {|
  mainPlane: typeof THREE.Mesh,
  debuggerPlane: ?typeof THREE.Mesh,
|};

class ArbitraryPlane {
  meshes: ArbitraryMeshes;
  isDirty: boolean;
  stopStoreListening: () => void;
  materialFactory: PlaneMaterialFactory;

  constructor() {
    this.isDirty = true;
    this.meshes = this.createMeshes();

    this.stopStoreListening = Store.subscribe(() => {
      this.isDirty = true;
    });
  }

  destroy() {
    this.stopStoreListening();
    this.materialFactory.stopListening();
  }

  updateAnchorPoints(anchorPoint: ?Vector4): void {
    if (anchorPoint) {
      this.meshes.mainPlane.material.setAnchorPoint(anchorPoint);
    }
  }

  setPosition = ({ x, y, z }: typeof THREE.Vector3) => {
    this.meshes.mainPlane.material.setGlobalPosition([x, y, z]);
  };

  addToScene(scene: typeof THREE.Scene) {
    _.values(this.meshes).forEach(mesh => {
      if (mesh) {
        scene.add(mesh);
      }
    });
  }

  update() {
    if (this.isDirty) {
      const matrix = getZoomedMatrix(Store.getState().flycam);

      const updateMesh = mesh => {
        if (!mesh) {
          return;
        }

        const meshMatrix = new THREE.Matrix4();
        meshMatrix.set(
          matrix[0],
          matrix[4],
          matrix[8],
          matrix[12],
          matrix[1],
          matrix[5],
          matrix[9],
          matrix[13],
          matrix[2],
          matrix[6],
          matrix[10],
          matrix[14],
          matrix[3],
          matrix[7],
          matrix[11],
          matrix[15],
        );

        mesh.matrix.identity();

        mesh.matrix.multiply(meshMatrix);
        mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
        mesh.matrixWorldNeedsUpdate = true;
      };

      _.values(this.meshes).forEach(updateMesh);
      this.isDirty = false;

      getSceneController().update(this);
    }
  }

  createMeshes(): ArbitraryMeshes {
    const adaptPlane = _plane => {
      _plane.rotation.x = Math.PI;
      _plane.matrixAutoUpdate = false;
      _plane.material.side = THREE.DoubleSide;
      return _plane;
    };

    this.materialFactory = new PlaneMaterialFactory(OrthoViews.PLANE_XY, false, 4);
    const textureMaterial = this.materialFactory.setup().getMaterial();

    const mainPlane = adaptPlane(
      new THREE.Mesh(
        new THREE.PlaneGeometry(constants.VIEWPORT_WIDTH, constants.VIEWPORT_WIDTH, 1, 1),
        textureMaterial,
      ),
    );

    const debuggerPlane = renderDebuggerPlane ? adaptPlane(this.createDebuggerPlane()) : null;

    return {
      mainPlane,
      debuggerPlane,
    };
  }

  createDebuggerPlane() {
    const debuggerMaterial = new THREE.ShaderMaterial({
      uniforms: this.materialFactory.uniforms,
      vertexShader: `
        uniform float sphericalCapRadius;
        varying vec3 vNormal;
        varying float isBorder;

        void main() {
          vec3 centerVertex = vec3(0.0, 0.0, -sphericalCapRadius);
          vec3 _position = position;
          _position += centerVertex;
          _position = _position * (sphericalCapRadius / length(_position));
          _position -= centerVertex;

          isBorder = mod(floor(position.x * 1.0), 2.0) + mod(floor(position.y * 1.0), 2.0) > 0.0 ? 1.0 : 0.0;

          gl_Position = projectionMatrix *
                        modelViewMatrix *
                        vec4(_position,1.0);
          vNormal = normalize((modelViewMatrix * vec4(_position, 1.0)).xyz);
        }
      `,
      fragmentShader: `
        varying mediump vec3 vNormal;
        varying float isBorder;
        void main() {
          mediump vec3 light = vec3(0.5, 0.2, 1.0);

          // ensure it's normalized
          light = normalize(light);

          // calculate the dot product of
          // the light to the vertex normal
          mediump float dProd = max(0.0, dot(vNormal, light));

          gl_FragColor = 1.0 - isBorder < 0.001 ? vec4(vec3(dProd, 1.0, 0.0), 0.9) : vec4(0.0);
        }
      `,
    });
    debuggerMaterial.transparent = true;

    shaderEditor.addMaterial(99, debuggerMaterial);

    const debuggerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(constants.VIEWPORT_WIDTH, constants.VIEWPORT_WIDTH, 50, 50),
      debuggerMaterial,
    );
    return debuggerPlane;
  }
}

export default ArbitraryPlane;
