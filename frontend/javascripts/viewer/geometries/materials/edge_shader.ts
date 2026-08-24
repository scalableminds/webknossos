import { M4x4 } from "libs/mjs";
import type TPS3D from "libs/thin_plate_spline";
import range from "lodash-es/range";
import template from "lodash-es/template";
import { type DataTexture, GLSL3, RawShaderMaterial } from "three";
import { COLOR_TEXTURE_WIDTH_FIXED } from "viewer/geometries/materials/node_shader";
import type { Uniforms } from "viewer/geometries/materials/plane_material_factory";
import { getTransformsForSkeletonLayer } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import shaderEditor from "viewer/model/helpers/shader_editor";
import {
  generateCalculateTpsOffsetFunction,
  generateTpsInitialization,
} from "viewer/shaders/thin_plate_spline.glsl";
import { Store } from "viewer/singletons";

class EdgeShader {
  material: RawShaderMaterial;
  uniforms: Uniforms = {};
  scaledTps: TPS3D | null = null;
  oldVertexShaderCode: string | null = null;
  storePropertyUnsubscribers: Array<() => void> = [];

  constructor(treeColorTexture: DataTexture) {
    this.setupUniforms(treeColorTexture);
    this.material = new RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      glslVersion: GLSL3,
    });
    shaderEditor.addMaterial("edge", this.material);
  }

  setupUniforms(treeColorTexture: DataTexture): void {
    this.uniforms = {
      activeTreeId: {
        value: Number.NaN,
      },
      treeColors: {
        value: treeColorTexture,
      },
      // When >= 0, edge fragments are discarded unless they lie on the currently
      // visible section. The value is the perpendicular axis of the rendered
      // viewport (0 = x, 1 = y, 2 = z). -1 disables section clipping. It is set
      // per render pass, see SceneController.updateSceneForCam.
      clippingAxis: {
        value: -1,
      },
      currentSectionFlycamPosition: {
        value: [0, 0, 0],
      },
    };

    const dataset = Store.getState().dataset;
    const nativelyRenderedLayerName =
      Store.getState().datasetConfiguration.nativelyRenderedLayerName;
    this.uniforms["transform"] = {
      value: M4x4.transpose(
        getTransformsForSkeletonLayer(dataset, nativelyRenderedLayerName).affineMatrix,
      ),
    };

    const { additionalCoordinates } = Store.getState().flycam;

    for (const coord of additionalCoordinates ?? []) {
      this.uniforms[`currentAdditionalCoord_${coord.name}`] = {
        value: 0,
      };
    }

    this.storePropertyUnsubscribers = [
      listenToStoreProperty(
        (storeState) => storeState.flycam.additionalCoordinates,
        (additionalCoordinates) => {
          for (const coord of additionalCoordinates ?? []) {
            this.uniforms[`currentAdditionalCoord_${coord.name}`].value = coord.value;
          }
        },
        true,
      ),

      listenToStoreProperty(
        (storeState) =>
          getTransformsForSkeletonLayer(
            storeState.dataset,
            storeState.datasetConfiguration.nativelyRenderedLayerName,
          ),
        (skeletonTransforms) => {
          const transforms = skeletonTransforms;
          const { affineMatrix } = transforms;

          const scaledTps = transforms.type === "thin_plate_spline" ? transforms.scaledTps : null;

          if (scaledTps) {
            this.scaledTps = scaledTps;
          } else {
            this.scaledTps = null;
          }

          this.uniforms["transform"].value = M4x4.transpose(affineMatrix);

          this.recomputeVertexShader();
        },
      ),
    ];
  }

  getMaterial(): RawShaderMaterial {
    return this.material;
  }

  recomputeVertexShader() {
    const newVertexShaderCode = this.getVertexShader();

    // Comparing to this.material.vertexShader does not work. The code seems
    // to be modified by a third party.
    if (this.oldVertexShaderCode != null && this.oldVertexShaderCode === newVertexShaderCode) {
      return;
    }

    this.oldVertexShaderCode = newVertexShaderCode;
    this.material.vertexShader = newVertexShaderCode;
    this.material.needsUpdate = true;
  }

  getVertexShader(): string {
    const { additionalCoordinates } = Store.getState().flycam;

    return template(`
precision highp float;
precision highp int;

out vec3 color;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float activeTreeId;
uniform sampler2D treeColors;

uniform mat4 transform;

<% if (tpsTransform != null) { %>
  <%= generateTpsInitialization({Skeleton: tpsTransform}, "Skeleton") %>
  <%= generateCalculateTpsOffsetFunction("Skeleton", true) %>
<% } %>

<% additionalCoordinates.map((coord) => { %>
  uniform float currentAdditionalCoord_<%= coord.name %>;
<% }) %>

in vec3 position;
in float treeId;

<% additionalCoordinates.map((coord) => { %>
  in float additionalCoord_<%= coord.name %>;
<% }) %>

out float alpha;
// Passed to the fragment shader so edges can be clipped partway along their
// length to the currently visible section (in voxel coordinates).
out vec3 v_position;

void main() {
    alpha = 1.0;
    <% additionalCoordinates.map((coord) => { %>
      if (!isnan(additionalCoord_<%= coord.name %>) && additionalCoord_<%= coord.name %> != currentAdditionalCoord_<%= coord.name %>) {
        alpha = 0.;
      }
    <% }) %>

    <% if (tpsTransform != null) { %>
      initializeTPSArraysForSkeleton();
    <% } %>

    ivec2 treeIdToTextureCoordinate = ivec2(
      mod(treeId, ${COLOR_TEXTURE_WIDTH_FIXED}),
      mod(floor(treeId / ${COLOR_TEXTURE_WIDTH_FIXED}), ${COLOR_TEXTURE_WIDTH_FIXED})
    );
    vec4 rgba = texelFetch(treeColors, treeIdToTextureCoordinate, 0);
    bool isVisible = rgba.a == 1.0;

    if (!isVisible) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    // As nodes are rendered in the center of a voxel, so are edges.
    vec3 positionWithOffset = position + vec3(0.5);
    v_position = positionWithOffset;

    <% if (tpsTransform != null) { %>
      vec3 tpsOffset = calculateTpsOffsetForSkeleton(positionWithOffset);
      vec4 transformedCoord = vec4(positionWithOffset + tpsOffset, 1.);
    <% } else { %>
      vec4 transformedCoord = transform * vec4(positionWithOffset, 1.);
    <% } %>
    gl_Position = projectionMatrix * modelViewMatrix * transformedCoord;


    color = rgba.rgb;
}`)({
      additionalCoordinates: additionalCoordinates || [],
      tpsTransform: this.scaledTps,
      generateTpsInitialization,
      generateCalculateTpsOffsetFunction,
      range,
    });
  }

  getFragmentShader(): string {
    return `
precision highp float;
precision highp int;

uniform int clippingAxis;
uniform vec3 currentSectionFlycamPosition;

out vec4 fragColor;
in vec3 color;
in float alpha;
in vec3 v_position;

void main()
{
    // Clip the edge to the currently visible section. Because v_position is
    // interpolated linearly across the edge (orthographic projection), this
    // discards exactly the part of the edge that lies outside the section,
    // yielding a partially rendered edge instead of an all-or-nothing one.
    if (clippingAxis >= 0) {
      float sectionStart = floor(currentSectionFlycamPosition[clippingAxis]);
      float perpCoord = v_position[clippingAxis];
      if (perpCoord < sectionStart || perpCoord >= sectionStart + 1.0) {
        discard;
      }
    }

    fragColor = vec4(color, alpha);
}`;
  }

  destroy() {
    for (const fn of this.storePropertyUnsubscribers) {
      fn();
    }
    this.storePropertyUnsubscribers = [];

    // Avoid memory leaks on tear down.
    for (const key of Object.keys(this.uniforms)) {
      this.uniforms[key].value = null;
    }
  }
}

export default EdgeShader;
