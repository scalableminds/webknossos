import _ from "lodash";
import type { DataTexture } from "three";
import { COLOR_TEXTURE_WIDTH_FIXED } from "viewer/geometries/materials/node_shader";
import { SkeletonShader } from "viewer/shaders/skeleton_shader";
import {
  generateCalculateTpsOffsetFunction,
  generateTpsInitialization,
} from "viewer/shaders/thin_plate_spline.glsl";
import { Store } from "viewer/singletons";

class EdgeShader extends SkeletonShader {
  constructor(treeColorTexture: DataTexture) {
    super("edge", treeColorTexture);
  }

  protected setupCustomUniforms(): void {
    // EdgeShader only needs the base skeleton uniforms
    // No additional custom uniforms required
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
