import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";
import constants, { PLANE_SUBDIVISION } from "viewer/constants";
import { type ExperimentContext, WebGlUnavailableError } from "./device_debug_runner";

// Chrome blocked WebGL for more than a minute after repeated crashes on a Galaxy S22.
const CONTEXT_CREATION_ATTEMPTS = 18;
const CONTEXT_CREATION_RETRY_DELAY_MS = 10000;
const CANVAS_SIZE = 512;

export type ShaderSources = { vertex: string; fragment: string };

// Uses the same context attributes as the renderer of WEBKNOSSOS (see renderer.ts).
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: false,
  preserveDrawingBuffer: true,
  stencil: false,
};

// After a GPU crash, the browser may refuse to create new contexts for a while.
export async function createWebGlContext(ex: ExperimentContext): Promise<WebGL2RenderingContext> {
  for (let attempt = 1; ; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
    if (gl != null && !gl.isContextLost()) {
      return gl;
    }
    if (attempt === CONTEXT_CREATION_ATTEMPTS) {
      throw new WebGlUnavailableError(
        `Could not create a WebGL 2 context (${attempt} attempts). The browser might block WebGL after a crash.`,
      );
    }
    await ex.wait(
      CONTEXT_CREATION_RETRY_DELAY_MS,
      `WebGL is not available right now (attempt ${attempt}/${CONTEXT_CREATION_ATTEMPTS}). If the browser shows a reload prompt, tap it. Retrying`,
    );
  }
}

export function loseContext(gl: WebGL2RenderingContext) {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

function describeEmptyLog(what: string) {
  return `${what} failed without an error log. This usually means that the GPU driver crashed.`;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader == null) throw new Error("createShader returned null.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const log = gl.getShaderInfoLog(shader)?.trim() ?? "";
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(log !== "" ? `Compilation failed:\n${log}` : describeEmptyLog("Compilation"));
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  // Like three.js
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);
  const log = gl.getProgramInfoLog(program)?.trim() ?? "";
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(log !== "" ? `Linking failed:\n${log}` : describeEmptyLog("Linking"));
  }
  return program;
}

function createDummyTexture(gl: WebGL2RenderingContext, samplerType: number): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const size = 4;
  if (samplerType === gl.UNSIGNED_INT_SAMPLER_2D) {
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, size, size);
    const data = new Uint32Array(size * size * 4).fill(1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
  } else if (samplerType === gl.INT_SAMPLER_2D) {
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32I, size, size);
    const data = new Int32Array(size * size * 4).fill(1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA_INTEGER, gl.INT, data);
  } else {
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
    const data = new Uint8Array(size * size * 4).fill(128);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  return texture;
}

// Draws a subdivided plane like the one WEBKNOSSOS uses for each viewport. Textures of the
// matching type are bound to all samplers. Most other uniforms keep their default (0).
function drawPlane(gl: WebGL2RenderingContext, program: WebGLProgram): string {
  // biome-ignore lint/correctness/useHookAtTopLevel: This is a WebGL function, not a React hook.
  gl.useProgram(program);
  const width = constants.VIEWPORT_WIDTH;
  const geometry = new PlaneGeometry(width, width, PLANE_SUBDIVISION, PLANE_SUBDIVISION);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attributeCount; i++) {
    const info = gl.getActiveAttrib(program, i);
    const attribute = info != null ? geometry.getAttribute(info.name) : null;
    if (info == null || attribute == null) continue;
    const location = gl.getAttribLocation(program, info.name);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, attribute.array as Float32Array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, attribute.itemSize, gl.FLOAT, false, 0, 0);
  }

  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Maps the plane to clip space.
  const projection = new Float32Array([
    2 / width,
    0,
    0,
    0,
    0,
    2 / width,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ]);
  const samplerTypes: number[] = [gl.SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D, gl.INT_SAMPLER_2D];
  // Create the textures before binding any of them to the units, since creating a texture
  // changes the binding of the active unit.
  const dummyTextures = new Map(samplerTypes.map((type) => [type, createDummyTexture(gl, type)]));
  let nextTextureUnit = 0;
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info == null) continue;
    const location = gl.getUniformLocation(program, info.name);
    if (location == null) continue;
    if (samplerTypes.includes(info.type)) {
      const texture = dummyTextures.get(info.type) ?? null;
      const units = [];
      for (let j = 0; j < info.size; j++) {
        gl.activeTexture(gl.TEXTURE0 + nextTextureUnit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        units.push(nextTextureUnit++);
      }
      gl.uniform1iv(location, units);
    } else if (info.type === gl.FLOAT_MAT4) {
      const matrix = info.name === "projectionMatrix" ? projection : identity;
      const values = new Float32Array(16 * info.size);
      for (let j = 0; j < info.size; j++) values.set(matrix, 16 * j);
      gl.uniformMatrix4fv(location, false, values);
    } else if (
      info.type === gl.FLOAT &&
      /(alpha|gammaCorrectionValue|zoomValue)$/.test(info.name)
    ) {
      gl.uniform1f(location, 1);
    }
  }

  const index = geometry.getIndex();
  if (index == null) throw new Error("Plane geometry has no index.");
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index.array as Uint16Array | Uint32Array, gl.STATIC_DRAW);
  const indexType = index.array instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, index.count, indexType, 0);
  geometry.dispose();
  return `Drew ${index.count / 3} triangles with ${nextTextureUnit} bound texture units.`;
}

// Compiles, links and draws the shaders in separate steps, so that a crash can be
// attributed to one of these stages.
export async function runShaderSteps(
  ex: ExperimentContext,
  getSources: (gl: WebGL2RenderingContext) => ShaderSources,
): Promise<void> {
  const gl = await ex.step("Create WebGL context", () => createWebGlContext(ex));
  ex.watchContext(gl);
  try {
    const sources = await ex.step("Generate shader code", (setDetails) => {
      const generatedSources = getSources(gl);
      setDetails(
        `Vertex shader: ${generatedSources.vertex.length} chars, fragment shader: ${generatedSources.fragment.length} chars`,
      );
      return generatedSources;
    });
    const vertexShader = await ex.step("Compile vertex shader", () =>
      compileShader(gl, gl.VERTEX_SHADER, sources.vertex),
    );
    const fragmentShader = await ex.step("Compile fragment shader", () =>
      compileShader(gl, gl.FRAGMENT_SHADER, sources.fragment),
    );
    const program = await ex.step("Link program", () =>
      linkProgram(gl, vertexShader, fragmentShader),
    );
    await ex.step("Draw", (setDetails) => setDetails(drawPlane(gl, program)));
  } finally {
    loseContext(gl);
  }
}

// Lets three.js add its prefix (version, defines, built-in uniforms and attributes) to
// the given ShaderMaterial shaders. Compiling and linking are skipped, so that this
// cannot crash.
export function getThreeShaderSources(
  gl: WebGL2RenderingContext,
  vertexShader: string,
  fragmentShader: string,
): ShaderSources {
  const sources: string[] = [];
  const patchedGl = gl as any;
  patchedGl.shaderSource = (_shader: WebGLShader, source: string) => sources.push(source);
  patchedGl.compileShader = () => {};
  patchedGl.linkProgram = () => {};
  const renderer = new WebGLRenderer({ canvas: gl.canvas as HTMLCanvasElement, context: gl });
  const material = new ShaderMaterial({ vertexShader, fragmentShader });
  const geometry = new PlaneGeometry(1, 1);
  try {
    const scene = new Scene();
    scene.add(new Mesh(geometry, material));
    renderer.compile(scene, new OrthographicCamera());
  } finally {
    // Fall back to the original prototype methods.
    delete patchedGl.shaderSource;
    delete patchedGl.compileShader;
    delete patchedGl.linkProgram;
    material.dispose();
    geometry.dispose();
    renderer.dispose();
  }
  if (sources.length !== 2) {
    throw new Error(`Expected two shader sources from three.js, got ${sources.length}.`);
  }
  return { vertex: sources[0], fragment: sources[1] };
}

// Replaces arrays of samplers (e.g., uniform sampler2D x_textures[2]) with separate sampler
// uniforms (x_textures_0, x_textures_1). This works for the WEBKNOSSOS shaders, since they
// only access these arrays with constant indices (see texture_access.glsl.ts).
export function replaceSamplerArrays(source: string): string {
  const arrayNames: string[] = [];
  let result = source.replace(
    /uniform\s+(highp\s+|mediump\s+|lowp\s+)?(\w*sampler2D)\s+(\w+)\[(\d+)\];/g,
    (_match, precision: string | undefined, type: string, name: string, count: string) => {
      arrayNames.push(name);
      return Array.from(
        { length: Number(count) },
        (_value, i) => `uniform ${precision ?? ""}${type} ${name}_${i};`,
      ).join("\n");
    },
  );
  for (const name of arrayNames) {
    result = result.replace(new RegExp(`\\b${name}\\[(\\d+)\\]`, "g"), `${name}_$1`);
  }
  return result;
}

const PROBE_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy / ${(constants.VIEWPORT_WIDTH / 2).toFixed(1)}, 0.0, 1.0);
}
`;

// Small shaders which each use a GLSL feature that the WEBKNOSSOS shaders rely on.
export const SHADER_PROBES: Array<{ id: string; label: string; sources: ShaderSources }> = [
  {
    id: "trivial",
    label: "Trivial shader",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
out vec4 color;
void main() {
  color = vec4(1.0, 0.0, 0.0, 1.0);
}
`,
    },
  },
  {
    id: "vectorModulo",
    label: "Integer vector modulo (ivec2 % int)",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
precision highp int;
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) % 4;
  color = vec4(vec2(p) / 4.0, 0.0, 1.0);
}
`,
    },
  },
  {
    id: "samplerArraySingle",
    label: "Array of one float sampler (like a WEBKNOSSOS uint8 color layer)",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
uniform highp sampler2D textures[1];
out vec4 color;
void main() {
  color = texelFetch(textures[0], ivec2(0, 0), 0);
}
`,
    },
  },
  {
    id: "samplerArrayFloat",
    label: "Array of four float samplers",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
uniform highp sampler2D textures[4];
out vec4 color;
void main() {
  ivec2 p = ivec2(0, 0);
  color = texelFetch(textures[0], p, 0) + texelFetch(textures[1], p, 0)
    + texelFetch(textures[2], p, 0) + texelFetch(textures[3], p, 0);
}
`,
    },
  },
  {
    id: "samplerArrayUint",
    label: "Array of four unsigned integer samplers",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D textures[4];
out vec4 color;
void main() {
  ivec2 p = ivec2(0, 0);
  uvec4 sum = texelFetch(textures[0], p, 0) + texelFetch(textures[1], p, 0)
    + texelFetch(textures[2], p, 0) + texelFetch(textures[3], p, 0);
  color = vec4(sum) / 255.0;
}
`,
    },
  },
  {
    id: "samplerArray",
    label: "Array of four unsigned integer samplers, indexed with vector modulo",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D textures[4];
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) % 4;
  uvec4 sum = texelFetch(textures[0], p, 0) + texelFetch(textures[1], p, 0)
    + texelFetch(textures[2], p, 0) + texelFetch(textures[3], p, 0);
  color = vec4(sum) / 255.0;
}
`,
    },
  },
  {
    id: "separateSamplers",
    label: "Four separate unsigned integer samplers, indexed with vector modulo",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D texture0;
uniform highp usampler2D texture1;
uniform highp usampler2D texture2;
uniform highp usampler2D texture3;
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) % 4;
  uvec4 sum = texelFetch(texture0, p, 0) + texelFetch(texture1, p, 0)
    + texelFetch(texture2, p, 0) + texelFetch(texture3, p, 0);
  color = vec4(sum) / 255.0;
}
`,
    },
  },
  {
    id: "vertexTextureFetch",
    label: "Texture fetch in vertex shader",
    sources: {
      vertex: `#version 300 es
precision highp float;
uniform highp usampler2D lookup;
in vec3 position;
flat out uint value;
void main() {
  value = texelFetch(lookup, ivec2(int(abs(position.x)) % 4, 0), 0).x;
  gl_Position = vec4(position.xy / ${(constants.VIEWPORT_WIDTH / 2).toFixed(1)}, 0.0, 1.0);
}
`,
      fragment: `#version 300 es
precision highp float;
flat in uint value;
out vec4 color;
void main() {
  color = vec4(float(value & 255u) / 255.0);
}
`,
    },
  },
  {
    id: "flatVaryingArrays",
    label: "Flat varying arrays (uint and float)",
    sources: {
      vertex: `#version 300 es
precision highp float;
in vec3 position;
flat out uint magIndices[3];
flat out float addresses[3];
void main() {
  for (int i = 0; i < 3; i++) {
    magIndices[i] = uint(i) + uint(abs(position.x));
    addresses[i] = position.y * float(i);
  }
  gl_Position = vec4(position.xy / ${(constants.VIEWPORT_WIDTH / 2).toFixed(1)}, 0.0, 1.0);
}
`,
      fragment: `#version 300 es
precision highp float;
flat in uint magIndices[3];
flat in float addresses[3];
out vec4 color;
void main() {
  color = vec4(float(magIndices[0] + magIndices[1] + magIndices[2]), addresses[0], addresses[1], addresses[2]);
}
`,
    },
  },
  {
    id: "matrixVarying",
    label: "mat4 varying",
    sources: {
      vertex: `#version 300 es
precision highp float;
in vec3 position;
out mat4 savedMatrix;
void main() {
  savedMatrix = mat4(position.x);
  gl_Position = vec4(position.xy / ${(constants.VIEWPORT_WIDTH / 2).toFixed(1)}, 0.0, 1.0);
}
`,
      fragment: `#version 300 es
precision highp float;
in mat4 savedMatrix;
out vec4 color;
void main() {
  color = savedMatrix[0];
}
`,
    },
  },
  {
    id: "hashLoop",
    label: "Integer hashing loop with texture lookups (like the cuckoo tables)",
    sources: {
      vertex: PROBE_VERTEX_SHADER,
      fragment: `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D table;
uniform highp uint seeds[3];
out vec4 color;
uint hashCombine(uint seed, uint key) {
  uint h = seed ^ key;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return h * 0x5bd1e995u;
}
void main() {
  uint key = uint(gl_FragCoord.x) * 7919u + uint(gl_FragCoord.y);
  uint found = 0u;
  for (int i = 0; i < 3; i++) {
    uint h = hashCombine(seeds[i], key) % 16u;
    uvec4 entry = texelFetch(table, ivec2(int(h % 4u), int(h / 4u)), 0);
    if (entry.x == key) {
      found = entry.y;
      break;
    }
  }
  color = vec4(float(found & 255u) / 255.0);
}
`,
    },
  },
];
