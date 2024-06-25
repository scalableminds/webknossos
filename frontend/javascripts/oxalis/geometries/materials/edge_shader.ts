import * as THREE from "three";
import { COLOR_TEXTURE_WIDTH_FIXED } from "oxalis/geometries/materials/node_shader";
import type { Uniforms } from "oxalis/geometries/materials/plane_material_factory";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import { Store } from "oxalis/singletons";
import _ from "lodash";
import { getTransformsForSkeletonLayer } from "oxalis/model/accessors/dataset_accessor";
import { M4x4 } from "libs/mjs";
import {
  generateCalculateTpsOffsetFunction,
  generateTpsInitialization,
} from "oxalis/shaders/thin_plate_spline.glsl";
import TPS3D from "libs/thin_plate_spline";

class EdgeShader {
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
    shaderEditor.addMaterial("edge", this.material);
  }

  setupUniforms(treeColorTexture: THREE.DataTexture): void {
    const state = Store.getState();
    this.uniforms = {
      activeTreeId: {
        value: NaN,
      },
      treeColors: {
        value: treeColorTexture,
      },
      datasetScale: {
        value: state.dataset.dataSource.scale,
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

    _.each(additionalCoordinates, (_val, idx) => {
      this.uniforms[`currentAdditionalCoord_${idx}`] = {
        value: 0,
      };
    });

    listenToStoreProperty(
      (storeState) => storeState.flycam.additionalCoordinates,
      (additionalCoordinates) => {
        _.each(additionalCoordinates, (coord, idx) => {
          this.uniforms[`currentAdditionalCoord_${idx}`].value = coord.value;
        });
      },
      true,
    );

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
uniform float activeTreeId;
uniform sampler2D treeColors;
uniform vec3 datasetScale;

uniform mat4 transform;

<% if (tpsTransform != null) { %>
  <%= generateTpsInitialization({Skeleton: tpsTransform}, "Skeleton") %>
  <%= generateCalculateTpsOffsetFunction("Skeleton", true) %>
<% } %>

<% _.range(additionalCoordinateLength).map((idx) => { %>
  uniform float currentAdditionalCoord_<%= idx %>;
<% }) %>

in vec3 position;
in float treeId;

<% _.range(additionalCoordinateLength).map((idx) => { %>
  in float additionalCoord_<%= idx %>;
<% }) %>

out float alpha;

void main() {
    alpha = 1.0;
    <% _.range(additionalCoordinateLength).map((idx) => { %>
      if (additionalCoord_<%= idx %> != currentAdditionalCoord_<%= idx %>) {
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

    <% if (tpsTransform != null) { %>
      vec3 tpsOffset = calculateTpsOffsetForSkeleton(position);
      vec4 transformedCoord = vec4(position + tpsOffset, 1.);
    <% } else { %>
      vec4 transformedCoord = transform * vec4(position, 1.);
    <% } %>
    gl_Position = projectionMatrix * modelViewMatrix * transformedCoord;


    color = rgba.rgb;
}`)({
      additionalCoordinateLength: (additionalCoordinates || []).length,
      tpsTransform: this.scaledTps,
      generateTpsInitialization,
      generateCalculateTpsOffsetFunction,
    });
  }

  getFragmentShader(): string {
    return `
precision highp float;

out vec4 fragColor;
in vec3 color;
in float alpha;

void main()
{
    fragColor = vec4(color, alpha);
}`;
  }
}

export default EdgeShader;
