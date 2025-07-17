import _ from "lodash";
import { Mesh, Matrix4, DoubleSide, PlaneGeometry, ShaderMaterial } from "three";
import constants, { OrthoViews } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import PlaneMaterialFactory from "viewer/geometries/materials/plane_material_factory";
import { getZoomedMatrix } from "viewer/model/accessors/flycam_accessor";
import shaderEditor from "viewer/model/helpers/shader_editor";
import Store from "viewer/store";
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
type ArbitraryMeshes = {
  mainPlane: Mesh;
  debuggerPlane: Mesh | null | undefined;
};

class ArbitraryPlane {
  meshes: ArbitraryMeshes;
  isDirty: boolean;
  stopStoreListening: () => void;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'materialFactory' has no initializer and ... Remove this comment to see the full error message
  materialFactory: PlaneMaterialFactory;

  constructor() {
    this.isDirty = true;
    this.meshes = this.createMeshes();
    this.stopStoreListening = Store.subscribe(() => {
      this.isDirty = true;
    });
  }

  stop() {
    this.stopStoreListening();
    this.materialFactory.stopListening();
  }

  addToScene(scene: Scene) {
    _.values(this.meshes).forEach((mesh) => {
      if (mesh) {
        scene.add(mesh);
      }
    });
  }

  update() {
    if (this.isDirty) {
      const matrix = getZoomedMatrix(Store.getState().flycam);

      const updateMesh = (mesh: Mesh | null | undefined) => {
        if (!mesh) {
          return;
        }

        const meshMatrix = new Matrix4();
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
        mesh.matrix.multiply(new Matrix4().makeRotationY(Math.PI));
        mesh.matrixWorldNeedsUpdate = true;
      };

      _.values(this.meshes).forEach(updateMesh);

      this.isDirty = false;
      getSceneController().update(this);
    }
  }

  createMeshes(): ArbitraryMeshes {
    const adaptPlane = (_plane: Mesh<PlaneGeometry, ShaderMaterial>) => {
      _plane.rotation.x = Math.PI;
      _plane.matrixAutoUpdate = false;
      _plane.material.side = DoubleSide;
      return _plane;
    };

    this.materialFactory = new PlaneMaterialFactory(OrthoViews.PLANE_XY, false, 4);
    const textureMaterial = this.materialFactory.setup().getMaterial();
    const mainPlane = adaptPlane(
      new Mesh(
        new PlaneGeometry(constants.VIEWPORT_WIDTH, constants.VIEWPORT_WIDTH, 1, 1),
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
    const debuggerMaterial = new ShaderMaterial({
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
    const debuggerPlane = new Mesh(
      new PlaneGeometry(constants.VIEWPORT_WIDTH, constants.VIEWPORT_WIDTH, 50, 50),
      debuggerMaterial,
    );
    return debuggerPlane;
  }

  destroy() {
    this.stopStoreListening();
    this.materialFactory.destroy();
  }
}

export default ArbitraryPlane;
