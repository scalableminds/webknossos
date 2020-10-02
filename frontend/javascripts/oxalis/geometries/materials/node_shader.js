// @flow
import * as THREE from "three";

import { ViewModeValues, ViewModeValuesIndices } from "oxalis/constants";
import type { Uniforms } from "oxalis/geometries/materials/plane_material_factory";
import { formatNumberAsGLSLFloat } from "oxalis/shaders/main_data_fragment.glsl";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Store from "oxalis/store";
import shaderEditor from "oxalis/model/helpers/shader_editor";

export const NodeTypes = {
  INVALID: 0.0,
  NORMAL: 1.0,
  BRANCH_POINT: 2.0,
};

export const COLOR_TEXTURE_WIDTH = 1024.0;
export const COLOR_TEXTURE_WIDTH_FIXED = COLOR_TEXTURE_WIDTH.toFixed(1);

class NodeShader {
  material: typeof THREE.RawShaderMaterial;
  uniforms: Uniforms;

  constructor(treeColorTexture: typeof THREE.DataTexture) {
    this.setupUniforms(treeColorTexture);

    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
    });

    shaderEditor.addMaterial("nodeFragment", this.material);
  }

  setupUniforms(treeColorTexture: typeof THREE.DataTexture): void {
    const state = Store.getState();

    this.uniforms = {
      planeZoomFactor: {
        type: "f",
        // The flycam zoom is typically decomposed into an x- and y-factor
        // which respects the aspect ratio. However, this value is merely used
        // for selecting an appropriate node size (gl_PointSize). The resulting points
        // will and should be square regardless of the plane's aspect ratio.
        value: getZoomValue(state.flycam),
      },
      datasetScale: {
        type: "f",
        value: getBaseVoxel(state.dataset.dataSource.scale),
      },
      overrideParticleSize: {
        type: "f",
        value: state.userConfiguration.particleSize,
      },
      viewportScale: {
        type: "f",
        value: 1,
      },
      overrideNodeRadius: {
        type: "i",
        value: true,
      },
      activeTreeId: {
        type: "f",
        value: NaN,
      },
      activeNodeId: {
        type: "f",
        value: NaN,
      },
      treeColors: {
        type: "t",
        value: treeColorTexture,
      },
      isPicking: {
        type: "i",
        value: 0,
      },
      isTouch: {
        type: "i",
        value: 0,
      },
      highlightCommentedNodes: {
        type: "f",
        value: state.userConfiguration.highlightCommentedNodes,
      },
      viewMode: {
        type: "f",
        value: 0,
      },
    };

    listenToStoreProperty(
      _state => _state.userConfiguration.highlightCommentedNodes,
      highlightCommentedNodes => {
        this.uniforms.highlightCommentedNodes.value = highlightCommentedNodes ? 1 : 0;
      },
    );

    listenToStoreProperty(
      storeState => storeState.temporaryConfiguration.viewMode,
      viewMode => {
        this.uniforms.viewMode.value = ViewModeValues.indexOf(viewMode);
      },
      true,
    );
  }

  getMaterial(): typeof THREE.RawShaderMaterial {
    return this.material;
  }

  getVertexShader(): string {
    return `
precision highp float;
precision highp int;

varying vec3 color;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float planeZoomFactor;
uniform float datasetScale;
uniform float viewportScale;
uniform float activeNodeId;
uniform float activeTreeId;
uniform float overrideParticleSize; // node radius for equally size nodes
uniform int overrideNodeRadius; // bool activates equaly node radius for all nodes
uniform int isPicking; // bool indicates whether we are currently rendering for node picking
uniform int isTouch; // bool that is used during picking and indicates whether the picking was triggered by a touch event
uniform float highlightCommentedNodes;
uniform float viewMode;

uniform sampler2D treeColors;

attribute float radius;
attribute vec3 position;
attribute float type;
attribute float isCommented;
// Since attributes are only supported in vertex shader, we pass the attribute into a
// varying to use in the fragment shader
varying float v_isHighlightedCommented;
varying float v_isActiveNode;
varying float v_innerPointSize;
varying float v_outerPointSize;
attribute float nodeId;
attribute float treeId;

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
    vec2 treeIdToTextureCoordinate = vec2(fract(
      treeId / ${COLOR_TEXTURE_WIDTH_FIXED}),
      treeId / (${COLOR_TEXTURE_WIDTH_FIXED} * ${COLOR_TEXTURE_WIDTH_FIXED}
    ));

    color = texture2D(treeColors, treeIdToTextureCoordinate).rgb;
    bool isVisible = texture2D(treeColors, treeIdToTextureCoordinate).a == 1.0;

    // DELETED OR INVISIBLE NODE
    if (type == ${NodeTypes.INVALID.toFixed(1)} || !isVisible) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    // NODE RADIUS
    if (overrideNodeRadius == 1) {
      gl_PointSize = overrideParticleSize;
    } else {
      gl_PointSize = max(
        radius / planeZoomFactor / datasetScale,
        overrideParticleSize
      ) * viewportScale;
    }

    // NODE COLOR FOR PICKING
    if (isPicking == 1) {
      // the nodeId is encoded in the RGB channels as a 3 digit base-255 number in a number of steps:
      // - nodeId is divided by the first three powers of 255.
      // - each quotient is rounded down to the nearest integer (since the fractional part of each quotient is covered by a less significant digit)
      // - each digit is divided by 255 again, since color values in OpenGL must be in the range [0, 1]
      // - finally, the non-fractional part of each digit is removed (since it is covered by a more significant digit)
      color = fract(floor(nodeId / vec3(255.0 * 255.0, 255.0, 1.0)) / 255.0);
      // Enlarge the nodes on mobile, so they're easier to select
      gl_PointSize = isTouch == 1 ? max(gl_PointSize * 1.5, 30.0) : max(gl_PointSize * 1.5, 10.0);
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

}`;
  }

  getFragmentShader(): string {
    return `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif

precision highp float;

uniform float viewMode;

varying vec3 color;
varying float v_isHighlightedCommented;
varying float v_isActiveNode;
varying float v_innerPointSize;
varying float v_outerPointSize;

void main()
{
    gl_FragColor = vec4(color, 1.0);

    // Add border to nodes with comments
    vec2 centerDistance = abs(gl_PointCoord - vec2(0.5));
    bool isWithinBorder = centerDistance.x < 0.20 && centerDistance.y < 0.20;
    if (v_isHighlightedCommented > 0.0 && isWithinBorder) {
      gl_FragColor  = vec4(1.0);
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

      #ifdef GL_OES_standard_derivatives
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
      #endif

      vec4 inner = vec4(color, alphaInner);
      vec4 outer = vec4(color, alphaOuter);
      gl_FragColor = mix(inner, outer, alphaOuter);

      if (gl_FragColor.a == 0.0) {
        // Discard that texel to avoid that the transparent halo content
        // overwrites other nodes.
        discard;
      }
    }
}`;
  }
}
export default NodeShader;
