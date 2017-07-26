// Adapted from https://github.com/AnalyticalGraphicsInc/webglreport
import _ from "lodash";

// eslint-disable-next-line import/prefer-default-export
export function getWebGLReport() {

  let webglVersion;

  if (window.WebGLRenderingContext) webglVersion = 1;
  if (window.WebGL2RenderingContext) webglVersion = 2;

  let report = {
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      webglVersion
  };


  if (!webglVersion) {
      // The browser does not support WebGL
      return report;
  }

  const canvas = document.createElement("canvas");
  let gl;
  const possibleNames = (webglVersion === 2) ? ["webgl2", "experimental-webgl2"] : ["webgl", "experimental-webgl"];
  const contextName = _.find(possibleNames, (name) => {
      gl = canvas.getContext(name, { stencil: true });
      return !!gl;
  });

  if (!gl) {
      // The browser supports WebGL, but initialization failed
      return report;
  }

  function describeRange(value) {
      return [value[0], value[1]];
  }

  function shaderPrecisionToObject(shaderPrecsiionType) {
    return {
      precision: shaderPrecsiionType.precision,
      rangeMax: shaderPrecsiionType.rangeMax,
      rangeMin: shaderPrecsiionType.rangeMin,
    }
  }

  function getMaxAnisotropy() {
      const e = gl.getExtension("EXT_texture_filter_anisotropic")
              || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic")
              || gl.getExtension("MOZ_EXT_texture_filter_anisotropic");

      if (e) {
          let max = gl.getParameter(e.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
          // See Canary bug: https://code.google.com/p/chromium/issues/detail?id=117450
          if (max === 0) {
              max = 2;
          }
          return max;
      }
      return "n/a";
  }


  function getBestFloatPrecision(shaderType) {
      const high = gl.getShaderPrecisionFormat(shaderType, gl.HIGH_FLOAT);
      const medium = gl.getShaderPrecisionFormat(shaderType, gl.MEDIUM_FLOAT);
      // const low = gl.getShaderPrecisionFormat(shaderType, gl.LOW_FLOAT);

      let best = high;
      if (high.precision === 0) {
          best = medium;
      }

      return best
  }

  function getFloatIntPrecision() {
      let high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      let s = (high.precision !== 0) ? "highp/" : "mediump/";

      high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_INT);
      s += (high.rangeMax !== 0) ? "highp" : "lowp";

      return s;
  }

  function isPowerOfTwo(n) {
      return (n !== 0) && ((n & (n - 1)) === 0);
  }

  function getAngle() {
      const lineWidthRange = describeRange(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE));

      // Heuristic: ANGLE is only on Windows, not in IE, and not in Edge, and does not implement line width greater than one.
      const angle = ((navigator.platform === "Win32") || (navigator.platform === "Win64")) &&
          (gl.getParameter(gl.RENDERER) !== "Internet Explorer") &&
          (gl.getParameter(gl.RENDERER) !== "Microsoft Edge") &&
          (lineWidthRange === [1,1]);

      if (angle) {
          // Heuristic: D3D11 backend does not appear to reserve uniforms like the D3D9 backend, e.g.,
          // D3D11 may have 1024 uniforms per stage, but D3D9 has 254 and 221.
          //
          // We could also test for WEBGL_draw_buffers, but many systems do not have it yet
          // due to driver bugs, etc.
          if (isPowerOfTwo(gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)) && isPowerOfTwo(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS))) {
              return "Yes, D3D11";
          } else {
              return "Yes, D3D9";
          }
      }

      return "No";
  }

  function getMaxColorBuffers() {
      let maxColorBuffers = 1;
      const ext = gl.getExtension("WEBGL_draw_buffers");
      if (ext != null)
          maxColorBuffers = gl.getParameter(ext.MAX_DRAW_BUFFERS_WEBGL);

      return maxColorBuffers;
  }

  function getUnmaskedInfo() {
      const unMaskedInfo = {
          renderer: "",
          vendor: ""
      };

      const dbgRenderInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbgRenderInfo != null) {
          unMaskedInfo.renderer = gl.getParameter(dbgRenderInfo.UNMASKED_RENDERER_WEBGL);
          unMaskedInfo.vendor   = gl.getParameter(dbgRenderInfo.UNMASKED_VENDOR_WEBGL);
      }

      return unMaskedInfo;
  }

  function showNull(v) {
      return (v === null) ? "n/a" : v;
  }

  function getWebGL2Status() {
    const webgl2Names = [
          "copyBufferSubData",
          "getBufferSubData",
          "blitFramebuffer",
          "framebufferTextureLayer",
          "getInternalformatParameter",
          "invalidateFramebuffer",
          "invalidateSubFramebuffer",
          "readBuffer",
          "renderbufferStorageMultisample",
          "texStorage2D",
          "texStorage3D",
          "texImage3D",
          "texSubImage3D",
          "copyTexSubImage3D",
          "compressedTexImage3D",
          "compressedTexSubImage3D",
          "getFragDataLocation",
          "uniform1ui",
          "uniform2ui",
          "uniform3ui",
          "uniform4ui",
          "uniform1uiv",
          "uniform2uiv",
          "uniform3uiv",
          "uniform4uiv",
          "uniformMatrix2x3fv",
          "uniformMatrix3x2fv",
          "uniformMatrix2x4fv",
          "uniformMatrix4x2fv",
          "uniformMatrix3x4fv",
          "uniformMatrix4x3fv",
          "vertexAttribI4i",
          "vertexAttribI4iv",
          "vertexAttribI4ui",
          "vertexAttribI4uiv",
          "vertexAttribIPointer",
          "vertexAttribDivisor",
          "drawArraysInstanced",
          "drawElementsInstanced",
          "drawRangeElements",
          "drawBuffers",
          "clearBufferiv",
          "clearBufferuiv",
          "clearBufferfv",
          "clearBufferfi",
          "createQuery",
          "deleteQuery",
          "isQuery",
          "beginQuery",
          "endQuery",
          "getQuery",
          "getQueryParameter",
          "createSampler",
          "deleteSampler",
          "isSampler",
          "bindSampler",
          "samplerParameteri",
          "samplerParameterf",
          "getSamplerParameter",
          "fenceSync",
          "isSync",
          "deleteSync",
          "clientWaitSync",
          "waitSync",
          "getSyncParameter",
          "createTransformFeedback",
          "deleteTransformFeedback",
          "isTransformFeedback",
          "bindTransformFeedback",
          "beginTransformFeedback",
          "endTransformFeedback",
          "transformFeedbackVaryings",
          "getTransformFeedbackVarying",
          "pauseTransformFeedback",
          "resumeTransformFeedback",
          "bindBufferBase",
          "bindBufferRange",
          "getIndexedParameter",
          "getUniformIndices",
          "getActiveUniforms",
          "getUniformBlockIndex",
          "getActiveUniformBlockParameter",
          "getActiveUniformBlockName",
          "uniformBlockBinding",
          "createVertexArray",
          "deleteVertexArray",
          "isVertexArray",
          "bindVertexArray"
      ];

      const webgl2 = (contextName.indexOf("webgl2") !== -1);

      const functions = [];
      let totalImplemented = 0;
      const length = webgl2Names.length;

      if (webgl2) {
          for (let i = 0; i < length; ++i) {
              const name = webgl2Names[i];
              if (webgl2 && gl[name]) {
                  ++totalImplemented;
                  functions.push(name);
              }
          }
      }

      return {
          status : totalImplemented,
          functions
      };
  }

  const webgl2Status = getWebGL2Status();

  report = _.extend(report, {
      contextName,
      glVersion: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      unMaskedVendor: getUnmaskedInfo().vendor,
      unMaskedRenderer: getUnmaskedInfo().renderer,
      antialias:  gl.getContextAttributes().antialias ? "Available" : "Not available",
      angle: getAngle(),
      maxColorBuffers: getMaxColorBuffers(),
      redBits: gl.getParameter(gl.RED_BITS),
      greenBits: gl.getParameter(gl.GREEN_BITS),
      blueBits: gl.getParameter(gl.BLUE_BITS),
      alphaBits: gl.getParameter(gl.ALPHA_BITS),
      depthBits: gl.getParameter(gl.DEPTH_BITS),
      stencilBits: gl.getParameter(gl.STENCIL_BITS),
      maxRenderBufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
      maxVertexAttributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
      aliasedLineWidthRange: describeRange(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE)),
      aliasedPointSizeRange: describeRange(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)),
      maxViewportDimensions: describeRange(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
      maxAnisotropy: getMaxAnisotropy(),
      vertexShaderBestPrecision: shaderPrecisionToObject(getBestFloatPrecision(gl.VERTEX_SHADER)),
      fragmentShaderBestPrecision: shaderPrecisionToObject(getBestFloatPrecision(gl.FRAGMENT_SHADER)),
      fragmentShaderFloatIntPrecision: getFloatIntPrecision(),

      extensions: gl.getSupportedExtensions(),
      // draftExtensionsInstructions: getDraftExtensionsInstructions(),

      webgl2Status : webgl2Status.status,
      webgl2Functions : webgl2Status.functions
  });

  if (webglVersion > 1) {
      report = _.extend(report, {
          maxVertexUniformComponents: showNull(gl.getParameter(gl.MAX_VERTEX_UNIFORM_COMPONENTS)),
          maxVertexUniformBlocks: showNull(gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS)),
          maxVertexOutputComponents: showNull(gl.getParameter(gl.MAX_VERTEX_OUTPUT_COMPONENTS)),
          maxVaryingComponents: showNull(gl.getParameter(gl.MAX_VARYING_COMPONENTS)),
          maxFragmentUniformComponents: showNull(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_COMPONENTS)),
          maxFragmentUniformBlocks: showNull(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS)),
          maxFragmentInputComponents: showNull(gl.getParameter(gl.MAX_FRAGMENT_INPUT_COMPONENTS)),
          minProgramTexelOffset: showNull(gl.getParameter(gl.MIN_PROGRAM_TEXEL_OFFSET)),
          maxProgramTexelOffset: showNull(gl.getParameter(gl.MAX_PROGRAM_TEXEL_OFFSET)),
          maxDrawBuffers: showNull(gl.getParameter(gl.MAX_DRAW_BUFFERS)),
          maxColorAttachments: showNull(gl.getParameter(gl.MAX_COLOR_ATTACHMENTS)),
          maxSamples: showNull(gl.getParameter(gl.MAX_SAMPLES)),
          max3dTextureSize: showNull(gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)),
          maxArrayTextureLayers: showNull(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)),
          maxTextureLodBias: showNull(gl.getParameter(gl.MAX_TEXTURE_LOD_BIAS)),
          maxUniformBufferBindings: showNull(gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS)),
          maxUniformBlockSize: showNull(gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE)),
          uniformBufferOffsetAlignment: showNull(gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT)),
          maxCombinedUniformBlocks: showNull(gl.getParameter(gl.MAX_COMBINED_UNIFORM_BLOCKS)),
          maxCombinedVertexUniformComponents: showNull(gl.getParameter(gl.MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS)),
          maxCombinedFragmentUniformComponents: showNull(gl.getParameter(gl.MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS)),
          maxTransformFeedbackInterleavedComponents: showNull(gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS)),
          maxTransformFeedbackSeparateAttribs: showNull(gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS)),
          maxTransformFeedbackSeparateComponents: showNull(gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS)),
          maxElementIndex: showNull(gl.getParameter(gl.MAX_ELEMENT_INDEX)),
          maxServerWaitTimeout: showNull(gl.getParameter(gl.MAX_SERVER_WAIT_TIMEOUT))
      });
  }

  return report;
}
