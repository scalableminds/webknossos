/**
 * arbitrary_plane.js
 * @flow
 */
import * as THREE from "three";
import _ from "lodash";

import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Store from "oxalis/store";
import constants, { OrthoViews, type Vector3, type Vector4 } from "oxalis/constants";
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
  mainPlane: THREE.Mesh,
  debuggerPlane: ?THREE.Mesh,
  diameter: ?THREE.Line,
|};

class ArbitraryPlane {
  meshes: ArbitraryMeshes;
  isDirty: boolean;
  stopStoreListening: () => void;
  materialFactory: PlaneMaterialFactory;
  scene: THREE.Scene;

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

  updateAnchorPoints(anchorPoint: ?Vector4, fallbackAnchorPoint: ?Vector4): void {
    if (anchorPoint) {
      this.meshes.mainPlane.material.setAnchorPoint(anchorPoint);
    }
    if (fallbackAnchorPoint) {
      this.meshes.mainPlane.material.setFallbackAnchorPoint(fallbackAnchorPoint);
    }
  }

  setPosition = ({ x, y, z }: THREE.Vector3) => {
    this.meshes.mainPlane.material.setGlobalPosition([x, y, z]);
  };

  addToScene(scene: THREE.Scene) {
    _.values(this.meshes).forEach(mesh => {
      if (mesh) {
        scene.add(mesh);
      }
      this.scene = scene;
    });
  }

  update() {
    if (this.isDirty) {
      const matrix = getZoomedMatrix(Store.getState().flycam);

      const updateMesh = mesh => {
        if (!mesh) {
          return;
        }
        if (mesh.type === "Line") {
          const currentMatrix = mesh.matrix.elements;
          const currentPosition = [currentMatrix[12], currentMatrix[13], currentMatrix[14]];
          mesh.matrix.set(
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
          mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
          const rotatedMatrix = mesh.matrix.elements;
          mesh.matrix.set(
            rotatedMatrix[0],
            rotatedMatrix[4],
            rotatedMatrix[8],
            currentPosition[0],
            rotatedMatrix[1],
            rotatedMatrix[5],
            rotatedMatrix[9],
            currentPosition[1],
            rotatedMatrix[2],
            rotatedMatrix[6],
            rotatedMatrix[10],
            currentPosition[2],
            rotatedMatrix[3],
            rotatedMatrix[7],
            rotatedMatrix[11],
            rotatedMatrix[15],
          );
          mesh.matrixWorldNeedsUpdate = true;
        } else {
          mesh.matrix.set(
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
          mesh.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
          mesh.matrixWorldNeedsUpdate = true;
        }
      };

      _.values(this.meshes).forEach(updateMesh);
      const ellipse = getSceneController().getDiameter();
      if (ellipse) {
        updateMesh(ellipse);
      }
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
    const diameter = adaptPlane(this.createDiameterMesh([500, 500, 500], 20, 20));

    return {
      mainPlane,
      debuggerPlane,
      diameter,
    };
  }

  setDiameter(position: Vector3, xRadius: number, yRadius: number) {
    this.scene.remove(this.meshes.diameter);
    console.log(position, xRadius, yRadius);
    this.meshes.diameter = this.createDiameterMesh(position, xRadius, yRadius);
    console.log("setting diameter", this.meshes.diameter);
    this.scene.add(this.meshes.diameter);
  }

  createDiameterMesh(position: Vector3, xRadius: number, yRadius: number): THREE.Line {
    const curve = new THREE.EllipseCurve(
      0, // posX
      0, // posY
      xRadius, // xRadius
      yRadius, // yRadius
      0, // aStartAngle
      2 * Math.PI, // aEndAngle
      false, // aClockwise
      0, // aRotation
    );
    const path = new THREE.Path(curve.getPoints(100));
    const geometrycirc = path.createPointsGeometry(50);
    const materialcirc = new THREE.LineBasicMaterial({
      color: 0xff0000,
    });
    // to change axis -> replace the old shape with a new one
    // rotation is handled in radian (not degrees)
    // Create the final object to add to the scene
    const ellipse = new THREE.Line(geometrycirc, materialcirc);
    ellipse.matrix.multiply(
      new THREE.Matrix4().makeTranslation(position[0], position[1], position[2]),
    );
    return ellipse;
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
