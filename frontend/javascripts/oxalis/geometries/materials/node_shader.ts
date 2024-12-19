import * as THREE from "three";
import { ViewModeValues, ViewModeValuesIndices } from "oxalis/constants";
import type { Uniforms } from "oxalis/geometries/materials/plane_material_factory";
import { getBaseVoxelInUnit } from "oxalis/model/scaleinfo";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { Store } from "oxalis/singletons";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import _ from "lodash";
import { formatNumberAsGLSLFloat } from "oxalis/shaders/utils.glsl";
import { M4x4 } from "libs/mjs";
import {
  generateCalculateTpsOffsetFunction,
  generateTpsInitialization,
} from "oxalis/shaders/thin_plate_spline.glsl";
import type TPS3D from "libs/thin_plate_spline";
import { getTransformsForSkeletonLayer } from "oxalis/model/accessors/dataset_layer_transformation_accessor";

export const NodeTypes = {
  INVALID: 0.0,
  NORMAL: 1.0,
  BRANCH_POINT: 2.0,
};
export const COLOR_TEXTURE_WIDTH = 1024.0;
export const COLOR_TEXTURE_WIDTH_FIXED = COLOR_TEXTURE_WIDTH.toFixed(1);

class NodeShader {
  material: THREE.RawShaderMaterial;
  uniforms: Uniforms = {};
  scaledTps: TPS3D | null = null;
  oldVertexShaderCode: string | null = null;

  constructor(treeColorTexture: THREE.DataTexture) {
    this.setupUniforms(treeColorTexture);
    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      glslVersion: THREE.GLSL3,
    });
    shaderEditor.addMaterial("node", this.material);
  }

  setupUniforms(treeColorTexture: THREE.DataTexture): void {
    const state = Store.getState();
    const { additionalCoordinates } = state.flycam;
    this.uniforms = {
      planeZoomFactor: {
        // The flycam zoom is typically decomposed into an x- and y-factor
        // which respects the aspect ratio. However, this value is merely used
        // for selecting an appropriate node size (gl_PointSize). The resulting points
        // will and should be square regardless of the plane's aspect ratio.
        value: getZoomValue(state.flycam),
      },
      voxelSizeMin: {
        value: getBaseVoxelInUnit(state.dataset.dataSource.scale.factor),
      },
      overrideParticleSize: {
        value: state.userConfiguration.particleSize,
      },
      viewportScale: {
        value: 1,
      },
      overrideNodeRadius: {
        value: true,
      },
      activeTreeId: {
        value: Number.NaN,
      },
      activeNodeId: {
        value: Number.NaN,
      },
      treeColors: {
        value: treeColorTexture,
      },
      isPicking: {
        value: 0,
      },
      isTouch: {
        value: 0,
      },
      highlightCommentedNodes: {
        value: state.userConfiguration.highlightCommentedNodes,
      },
      viewMode: {
        value: 0,
      },
    };

    _.each(additionalCoordinates, (_val, idx) => {
      this.uniforms[`currentAdditionalCoord_${idx}`] = {
        value: 0,
      };
    });

    listenToStoreProperty(
      (_state) => _state.userConfiguration.highlightCommentedNodes,
      (highlightCommentedNodes) => {
        this.uniforms.highlightCommentedNodes.value = highlightCommentedNodes ? 1 : 0;
      },
    );
    listenToStoreProperty(
      (storeState) => storeState.temporaryConfiguration.viewMode,
      (viewMode) => {
        this.uniforms.viewMode.value = ViewModeValues.indexOf(viewMode);
      },
      true,
    );
    listenToStoreProperty(
      (storeState) => storeState.flycam.additionalCoordinates,
      (additionalCoordinates) => {
        _.each(additionalCoordinates, (coord, idx) => {
          this.uniforms[`currentAdditionalCoord_${idx}`].value = coord.value;
        });
      },
      true,
    );

    const dataset = Store.getState().dataset;
    const nativelyRenderedLayerName =
      Store.getState().datasetConfiguration.nativelyRenderedLayerName;

    const { affineMatrix } = getTransformsForSkeletonLayer(dataset, nativelyRenderedLayerName);
    this.uniforms["transform"] = {
      value: M4x4.transpose(affineMatrix),
    };

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
    );
  }

  getMaterial(): THREE.RawShaderMaterial {
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

    return _.template(`
precision highp float;
precision highp int;

out vec3 color;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float planeZoomFactor;
uniform float voxelSizeMin;
uniform float viewportScale;
uniform float activeNodeId;
uniform float activeTreeId;
uniform float overrideParticleSize; // node radius for equally size nodes
uniform int overrideNodeRadius; // bool activates equal node radius for all nodes
uniform int isPicking; // bool indicates whether we are currently rendering for node picking
uniform int isTouch; // bool that is used during picking and indicates whether the picking was triggered by a touch event
uniform float highlightCommentedNodes;
uniform float viewMode;

uniform mat4 transform;

<% if (tpsTransform != null) { %>
  <%= generateTpsInitialization({Skeleton: tpsTransform}, "Skeleton") %>
  <%= generateCalculateTpsOffsetFunction("Skeleton", true) %>
<% } %>

<% _.range(additionalCoordinateLength).map((idx) => { %>
  uniform float currentAdditionalCoord_<%= idx %>;
<% }) %>

uniform sampler2D treeColors;

in float radius;
in vec3 position;

<% _.range(additionalCoordinateLength).map((idx) => { %>
  in float additionalCoord_<%= idx %>;
<% }) %>


in float type;
in float isCommented;
// Since attributes are only supported in vertex shader, we pass the attribute into a
// out variable to use in the fragment shader
out float v_isHighlightedCommented;
out float v_isActiveNode;
out float v_innerPointSize;
out float v_outerPointSize;
in float nodeId;
in float treeId;

// https://www.shadertoy.com/view/XljGzV
vec3 rgb2hsv(vec3 color) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
    vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// https://www.shadertoy.com/view/XljGzV
vec3 hsv2rgb(vec3 color) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(color.xxx + K.xyz) * 6.0 - K.www);
    return color.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), color.y);
}

vec3 shiftHue(vec3 color, float shiftValue) {
    vec3 hsvColor = rgb2hsv(color);
    hsvColor.x = fract(hsvColor.x + shiftValue);
    return hsv2rgb(hsvColor);
}

void main() {
    <% _.range(additionalCoordinateLength).map((idx) => { %>
      if (additionalCoord_<%= idx %> != currentAdditionalCoord_<%= idx %>) {
        return;
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

    color = rgba.rgb;
    float alpha = rgba.a;
    // A alpha value of 0.5 indicates that the edges of the tree are not visible but its nodes are.
    bool isVisible = alpha == 1.0 || alpha == 0.5 ;

    // DELETED OR INVISIBLE NODE
    if (type == ${NodeTypes.INVALID.toFixed(1)} || !isVisible) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    <% if (tpsTransform != null) { %>
      vec3 tpsOffset = calculateTpsOffsetForSkeleton(position);
      vec4 transformedCoord = vec4(position + tpsOffset, 1.);
    <% } else { %>
      vec4 transformedCoord = transform * vec4(position, 1.);
    <% } %>
    gl_Position = projectionMatrix * modelViewMatrix * transformedCoord;

    // NODE RADIUS
    if (overrideNodeRadius == 1) {
      gl_PointSize = overrideParticleSize;
    } else {
      gl_PointSize = max(
        radius / planeZoomFactor / voxelSizeMin,
        overrideParticleSize
      ) * viewportScale;
    }

    // NODE COLOR FOR PICKING
    if (isPicking == 1) {
      // the nodeId is encoded in the RGB channels as a 3 digit base-256 number in a number of steps:
      // - nodeId is divided by the first three powers of 256.
      // - each quotient is rounded down to the nearest integer (since the fractional part of each quotient is covered by a less significant digit)
      // - each digit is mod'ed by 256 (i.e., ignore the higher significant digit)
      // - finally, the number is divided by 255 because the color values in WebglGL must be in the range [0, 1]
      color = mod(floor(nodeId / vec3(256.0 * 256.0, 256.0, 1.0)), 256.0) / 255.0;
      // Enlarge the nodes on mobile, so they're easier to select
      gl_PointSize = isTouch == 1 ? max(gl_PointSize * 1.5, 30.0) : max(gl_PointSize * 1.5, 15.0);
      return;
    }

    // NODE COLOR FOR ACTIVE NODE
    v_isActiveNode = activeNodeId == nodeId ? 1.0 : 0.0;
    if (v_isActiveNode > 0.0) {
      bool isOrthogonalMode = viewMode == ${formatNumberAsGLSLFloat(
        ViewModeValuesIndices.Orthogonal,
      )};

      v_innerPointSize = gl_PointSize;
      v_outerPointSize = isOrthogonalMode
        ? v_innerPointSize + 25.0
        : v_innerPointSize * 1.5;
      gl_PointSize = v_outerPointSize;

      // Shift hue to further highlight active node in arbitrary mode.
      color = shiftHue(color, isOrthogonalMode ? 0. : 0.15);
    }

    float isBranchpoint =
      type == ${NodeTypes.BRANCH_POINT.toFixed(1)}
      ? 1.0 : 0.0;
    // NODE COLOR FOR BRANCH_POINT
    if (isBranchpoint == 1.0) {
      color = shiftHue(color, 0.5);
    }
    // Since attributes are only supported in vertex shader, we pass the attribute into a
    // varying to use in the fragment shader
    v_isHighlightedCommented = highlightCommentedNodes > 0.0 && isCommented > 0.0 ? 1.0 : 0.0;
    if (v_isHighlightedCommented > 0.0) {
      // Make commented nodes twice as large so that the border can be displayed correctly
      // and recognizable
      gl_PointSize *= 2.0;
    }

}`)({
      additionalCoordinateLength: (additionalCoordinates || []).length,
      tpsTransform: this.scaledTps,
      generateTpsInitialization,
      generateCalculateTpsOffsetFunction,
    });
  }

  getFragmentShader(): string {
    return `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif

precision highp float;

uniform float viewMode;

in vec3 color;
in float v_isHighlightedCommented;
in float v_isActiveNode;
in float v_innerPointSize;
in float v_outerPointSize;

out vec4 outputColor;


void main()
{
    outputColor = vec4(color, 1.0);

    // Add border to nodes with comments
    vec2 centerDistance = abs(gl_PointCoord - vec2(0.5));
    bool isWithinBorder = centerDistance.x < 0.20 && centerDistance.y < 0.20;
    if (v_isHighlightedCommented > 0.0 && isWithinBorder) {
      outputColor  = vec4(1.0);
    };

    // Give active node a "halo"
    if (v_isActiveNode > 0.0) {
      float r = 0.0, delta = 0.0, alphaInner = 1.0, alphaOuter = 1.0;

      bool isOrthogonalMode = viewMode == ${formatNumberAsGLSLFloat(
        ViewModeValuesIndices.Orthogonal,
      )};

      // cxy is between -1.0 and +1.0
      vec2 cxy = 2.0 * gl_PointCoord - 1.0;
      // r is the length from the center of the point to the active texel
      r = dot(cxy, cxy);
      float relativeInnerNodeRadius = 0.5 * v_innerPointSize / v_outerPointSize;

      delta = fwidth(r);

      if (isOrthogonalMode) {
        // Make the inner node a square so that it looks exactly as a non-active node. The halo
        // will ensure that the active node is recognizable.
        float maxCenterDistance = max(centerDistance.x, centerDistance.y);
        alphaInner = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, maxCenterDistance / relativeInnerNodeRadius);
        alphaOuter = 1.0 - smoothstep(0.0, delta, abs(1.0 - delta - r));
      } else {
        // In non-ortho mode, we do not show a halo. Therefore, make the active node round
        // to give at least a slight clue, which node is active.
        alphaInner = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, r / relativeInnerNodeRadius);
        alphaOuter = 0.0;
      }

      alphaOuter = max(0.0, alphaOuter - alphaInner);

      vec4 inner = vec4(color, alphaInner);
      vec4 outer = vec4(color, alphaOuter);
      outputColor = mix(inner, outer, alphaOuter);

      if (outputColor.a == 0.0) {
        // Discard that texel to avoid that the transparent halo content
        // overwrites other nodes.
        discard;
      }
    }
}`;
  }
}

export default NodeShader;
