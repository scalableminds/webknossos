import { AbstractCuckooTable } from "libs/cuckoo/abstract_cuckoo_table";
import { CuckooTableUint32 } from "libs/cuckoo/cuckoo_table_uint32";
import { CuckooTableVec3 } from "libs/cuckoo/cuckoo_table_vec3";
import { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import type UpdatableTexture from "libs/UpdatableTexture";
import {
  DoubleSide,
  Mesh,
  OrthographicCamera,
  type PixelFormat,
  PlaneGeometry,
  RGBAFormat,
  RGBAIntegerFormat,
  RGIntegerFormat,
  Scene,
  ShaderMaterial,
  type WebGLRenderer,
} from "three";
import type { ElementClass } from "types/api_types";
import constants, { PLANE_SUBDIVISION } from "viewer/constants";
import { destroyRenderer, getRenderer } from "viewer/controller/renderer";
import { createUpdatableTexture } from "viewer/geometries/materials/plane_material_factory_helpers";
import {
  computeDataTexturesSetup,
  type GpuSpecs,
  getDtypeConfigForElementClass,
  type LayerLike,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { MAPPING_TEXTURE_WIDTH } from "viewer/model/bucket_data_handling/mappings";
import getMainFragmentShader, {
  getMainVertexShader,
  type Params as ShaderParams,
} from "viewer/shaders/main_data_shaders.glsl";
import { createWorker } from "viewer/workers/comlink_wrapper";
import type Compress from "viewer/workers/compress.worker";
import {
  createWebGlContext,
  getThreeShaderSources,
  loseContext,
  replaceSamplerArrays,
  runShaderSteps,
  SHADER_PROBES,
} from "./device_debug_raw_gl";
import {
  type Experiment,
  type ExperimentContext,
  nextFrame,
  type PreviousResults,
  sleep,
} from "./device_debug_runner";

// Mirror the constants from layer_rendering_manager.ts
const LOOKUP_CUCKOO_TEXTURE_WIDTH = 256;
const CUSTOM_COLORS_TEXTURE_WIDTH = 512;

const MB = 1024 ** 2;
const JS_MEMORY_CHUNK_MB = 64;
const JS_MEMORY_LIMIT_MB = 512;
// 4096² RGBA8 textures (64 MB each)
const STRESS_TEXTURE_WIDTH = 4096;
const GPU_STRESS_LIMIT_MB = 2048;

type SimulatedLayer = { name: string; layer: LayerLike };

type LayerPlan = SimulatedLayer & {
  textureSize: number;
  textureCount: number;
};

const formatMB = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

function simulateLayer(
  name: string,
  category: "color" | "segmentation",
  elementClass: ElementClass,
) {
  return {
    name,
    layer: { elementClass, category, boundingBox: { depth: 1024 }, additionalAxes: null },
  };
}

const COLOR_UINT8 = simulateLayer("color", "color", "uint8");
const SEGMENTATION_UINT32 = simulateLayer("segmentation", "segmentation", "uint32");
const SEGMENTATION_UINT64 = simulateLayer("segmentation", "segmentation", "uint64");

// Like getSupportedTextureSpecs, but uses the given context instead of creating a new one.
function readGpuSpecs(gl: WebGL2RenderingContext): GpuSpecs {
  return {
    supportedTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxTextureCount: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
  };
}

// Computes the data texture setup like WEBKNOSSOS does with the default GPU memory factor.
function planLayers(specs: GpuSpecs, layers: SimulatedLayer[]) {
  const requiredBucketCapacity =
    constants.GPU_FACTOR_MULTIPLIER * constants.DEFAULT_GPU_MEMORY_FACTOR;
  const setup = computeDataTexturesSetup(
    specs,
    layers.map(({ layer }) => layer),
    layers.some(({ layer }) => layer.category === "segmentation"),
    requiredBucketCapacity,
  );
  const plans: LayerPlan[] = layers.map(({ name, layer }) => {
    const info = setup.textureInformationPerLayer.get(layer);
    if (info == null) throw new Error(`No texture information for ${name}`);
    return { name, layer, textureSize: info.textureSize, textureCount: info.textureCount };
  });
  return { plans, setup, requiredBucketCapacity };
}

function getChannelCount(format: PixelFormat): number {
  switch (format) {
    case RGBAFormat:
    case RGBAIntegerFormat:
      return 4;
    case RGIntegerFormat:
      return 2;
    default:
      throw new Error(`Unexpected pixel format ${format}`);
  }
}

function getTextureByteSize(width: number, elementClass: ElementClass): number {
  const { pixelFormat, TypedArrayClass } = getDtypeConfigForElementClass(elementClass);
  return width * width * getChannelCount(pixelFormat) * TypedArrayClass.BYTES_PER_ELEMENT;
}

// Same as sanitizeName in plane_material_factory.ts (not imported to avoid pulling in the
// whole viewer model).
function sanitizeName(name: string): string {
  return `layer_${btoa(name).replace(/=+/g, "")}`;
}

function getShaderParams(plans: LayerPlan[], maximumLayerCountToRender: number): ShaderParams {
  // Only compile as many layers as the GPU supports (see PlaneMaterialFactory.getLayersToRender).
  const renderedPlans = plans.slice(0, maximumLayerCountToRender);
  const colorLayerNames = renderedPlans
    .filter((plan) => plan.layer.category === "color")
    .map((plan) => sanitizeName(plan.name));
  const segmentationLayerNames = renderedPlans
    .filter((plan) => plan.layer.category === "segmentation")
    .map((plan) => sanitizeName(plan.name));
  const textureLayerInfos: ShaderParams["textureLayerInfos"] = {};
  for (const plan of plans) {
    const dtypeConfig = getDtypeConfigForElementClass(plan.layer.elementClass);
    textureLayerInfos[sanitizeName(plan.name)] = {
      packingDegree: dtypeConfig.packingDegree,
      glslPrefix: dtypeConfig.glslPrefix,
      dataTextureCount: plan.textureCount,
      isSigned: dtypeConfig.isSigned,
      elementClass: plan.layer.elementClass,
      isColor: plan.layer.category === "color",
      unsanitizedName: plan.name,
    };
  }
  return {
    globalLayerCount: plans.length,
    colorLayerNames,
    orderedColorLayerNames: colorLayerNames,
    segmentationLayerNames,
    textureLayerInfos,
    // Assume 8 magnifications per layer.
    magnificationsCount: 8 * plans.length,
    voxelSizeFactor: [11, 11, 24],
    voxelSizeFactorInverted: [1 / 11, 1 / 11, 1 / 24],
    isOrthogonal: true,
    // The default of the dataset settings
    useInterpolation: false,
    tpsTransformPerLayer: {},
    isWindows: false,
  };
}

function getWebknossosShaders(layers: SimulatedLayer[], specs: GpuSpecs) {
  const { plans, setup } = planLayers(specs, layers);
  const params = getShaderParams(plans, setup.maximumLayerCountToRender);
  return { vertex: getMainVertexShader(params), fragment: getMainFragmentShader(params), plans };
}

function allocateTexture(
  renderer: WebGLRenderer,
  width: number,
  elementClass: ElementClass,
): UpdatableTexture {
  // Same as TextureBucketManager.setupDataTextures
  const { textureType, pixelFormat, internalFormat } = getDtypeConfigForElementClass(elementClass);
  const texture = createUpdatableTexture(
    width,
    width,
    textureType,
    renderer,
    pixelFormat,
    internalFormat,
  );
  // WEBKNOSSOS initializes the texture lazily on the first update. Do it explicitly to
  // separate the allocation from the upload.
  renderer.initTexture(texture);
  return texture;
}

function fillTexture(texture: UpdatableTexture, width: number, elementClass: ElementClass) {
  const { pixelFormat, TypedArrayClass } = getDtypeConfigForElementClass(elementClass);
  const elementsPerRow = width * getChannelCount(pixelFormat);
  // Upload in strips of ~4 MB to avoid allocating a CPU buffer as large as the texture.
  const rowsPerStrip = Math.max(
    1,
    Math.floor((4 * MB) / TypedArrayClass.BYTES_PER_ELEMENT / elementsPerRow),
  );
  const strip = new TypedArrayClass(rowsPerStrip * elementsPerRow);
  // @ts-expect-error BigInt arrays are not used for textures.
  strip.fill(7);
  for (let y = 0; y < width; y += rowsPerStrip) {
    const height = Math.min(rowsPerStrip, width - y);
    texture.update(strip.subarray(0, height * elementsPerRow), 0, y, width, height);
  }
}

async function collectEnvironmentInfo(): Promise<string> {
  const nav = navigator as any;
  const memory = (performance as any).memory;
  const lines = [
    `User agent: ${navigator.userAgent}`,
    `Platform: ${nav.userAgentData?.platform ?? navigator.platform}`,
    `Device memory: ${nav.deviceMemory ?? "unknown"} GB`,
    `Hardware concurrency: ${navigator.hardwareConcurrency}`,
    `Screen: ${screen.width}×${screen.height}, devicePixelRatio: ${window.devicePixelRatio}`,
    `Window: ${window.innerWidth}×${window.innerHeight}`,
    `crossOriginIsolated: ${window.crossOriginIsolated}`,
    `SharedArrayBuffer: ${typeof SharedArrayBuffer !== "undefined"}`,
    `OffscreenCanvas: ${typeof OffscreenCanvas !== "undefined"}`,
  ];
  if (memory != null) {
    lines.push(`JS heap limit: ${formatMB(memory.jsHeapSizeLimit)}`);
  }
  if (navigator.storage?.estimate != null) {
    const estimate = await navigator.storage.estimate();
    lines.push(
      `Storage: ${formatMB(estimate.usage ?? 0)} used of ${formatMB(estimate.quota ?? 0)}`,
    );
  }
  return lines.join("\n");
}

async function testWorker(): Promise<string> {
  const compress = createWorker<typeof Compress>("compress.worker.ts");
  const result = await Promise.race([
    compress("Hello from the debug page".repeat(100)),
    sleep(10000).then(() => {
      throw new Error("The worker did not respond within 10 s.");
    }),
  ]);
  return `Worker compressed 2500 bytes to ${result.byteLength} bytes.`;
}

function describeWebGl(gl: WebGL2RenderingContext): string {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const parameterNames = [
    "MAX_TEXTURE_SIZE",
    "MAX_TEXTURE_IMAGE_UNITS",
    "MAX_COMBINED_TEXTURE_IMAGE_UNITS",
    "MAX_VERTEX_TEXTURE_IMAGE_UNITS",
    "MAX_FRAGMENT_UNIFORM_VECTORS",
    "MAX_VERTEX_UNIFORM_VECTORS",
    "MAX_VARYING_VECTORS",
    "MAX_RENDERBUFFER_SIZE",
    "MAX_VIEWPORT_DIMS",
  ] as const;
  return [
    `Vendor: ${debugInfo != null ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)}`,
    `Renderer: ${debugInfo != null ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`,
    `Version: ${gl.getParameter(gl.VERSION)}`,
    `GLSL: ${gl.getParameter(gl.SHADING_LANGUAGE_VERSION)}`,
    ...parameterNames.map((name) => `${name}: ${String(gl.getParameter(gl[name]))}`),
    `High precision float in fragment shader: ${gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision}`,
    `High precision int in fragment shader: ${gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_INT)?.rangeMax}`,
    `Extensions: ${(gl.getSupportedExtensions() ?? []).join(", ")}`,
  ].join("\n");
}

// Allocates the textures of a dataset with a uint8 color and a uint32 segmentation layer
// like WEBKNOSSOS and renders with the WEBKNOSSOS shader via three.js.
async function runRealisticSetup(ex: ExperimentContext) {
  const layers = [COLOR_UINT8, SEGMENTATION_UINT32];
  // getRenderer uses the canvas with this id.
  const canvas = document.createElement("canvas");
  canvas.id = "render-canvas";
  canvas.style.cssText = "position: fixed; left: 0; bottom: 0; width: 256px; height: 256px;";
  document.body.appendChild(canvas);
  const dataTexturesByLayer = new Map<string, UpdatableTexture[]>();
  let lookUpTable: CuckooTableVec5 | undefined;
  let colorTable: CuckooTableVec3 | undefined;
  let mappingTable: CuckooTableUint32 | undefined;
  let mesh: Mesh<PlaneGeometry, ShaderMaterial> | undefined;

  try {
    // Wait until WebGL is available, since three.js does not retry.
    await ex.step("Wait for WebGL availability", async () => {
      loseContext(await createWebGlContext(ex));
    });
    const renderer = await ex.step("Create three.js WebGLRenderer (like WEBKNOSSOS)", () => {
      const renderer = getRenderer();
      const gl = typeof renderer.getContext === "function" ? renderer.getContext() : null;
      if (gl == null || gl.isContextLost()) {
        throw new Error("Could not create a WebGL context for the renderer.");
      }
      // Like WEBKNOSSOS, ignore the devicePixelRatio.
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      return renderer;
    });
    ex.watchContext(renderer.getContext() as WebGL2RenderingContext);

    const { plans, setup } = await ex.step("Compute texture setup", (setDetails) => {
      const result = planLayers(
        readGpuSpecs(renderer.getContext() as WebGL2RenderingContext),
        layers,
      );
      setDetails(
        result.plans
          .map(
            (plan) =>
              `${plan.name} (${plan.layer.elementClass}): ${plan.textureCount}× ${plan.textureSize}²`,
          )
          .join("\n"),
      );
      return result;
    });

    await ex.step(`Create bucket lookup table (${LOOKUP_CUCKOO_TEXTURE_WIDTH}² RGBA32UI)`, () => {
      lookUpTable = new CuckooTableVec5(LOOKUP_CUCKOO_TEXTURE_WIDTH);
    });

    for (const plan of plans) {
      const textures: UpdatableTexture[] = [];
      dataTexturesByLayer.set(plan.name, textures);
      const size = formatMB(getTextureByteSize(plan.textureSize, plan.layer.elementClass));
      for (let i = 0; i < plan.textureCount; i++) {
        await ex.step(
          `Allocate data texture ${i + 1}/${plan.textureCount} for ${plan.name} (${plan.textureSize}², ${plan.layer.elementClass}, ${size})`,
          () => {
            textures.push(allocateTexture(renderer, plan.textureSize, plan.layer.elementClass));
          },
        );
        await ex.step(`Upload data to texture ${i + 1}/${plan.textureCount} of ${plan.name}`, () =>
          fillTexture(textures[i], plan.textureSize, plan.layer.elementClass),
        );
      }
    }

    await ex.step(`Create segment color table (${CUSTOM_COLORS_TEXTURE_WIDTH}² RGBA32UI)`, () => {
      colorTable = new CuckooTableVec3(CUSTOM_COLORS_TEXTURE_WIDTH);
    });
    const mappingTextureBytes = MAPPING_TEXTURE_WIDTH ** 2 * 16;
    await ex.step(
      `Create mapping table (${MAPPING_TEXTURE_WIDTH}² RGBA32UI, ${formatMB(mappingTextureBytes)} CPU + ${formatMB(mappingTextureBytes)} GPU)`,
      () => {
        // WEBKNOSSOS always creates this table when the dataset has a segmentation layer
        // (see PlaneMaterialFactory.attachSegmentationMappingTextures).
        mappingTable = new CuckooTableUint32(MAPPING_TEXTURE_WIDTH);
      },
    );

    // If sampler arrays are known to crash, test whether the rest of the setup works with
    // the workaround.
    const avoidSamplerArrays = areSamplerArraysBroken(ex);
    const { scene, camera } = await ex.step(
      avoidSamplerArrays
        ? "Compile WEBKNOSSOS shaders via three.js (with separate samplers instead of sampler arrays)"
        : "Compile WEBKNOSSOS shaders via three.js",
      (setDetails) => {
        const params = getShaderParams(plans, setup.maximumLayerCountToRender);
        const nullTexture = AbstractCuckooTable.getNullTexture();
        const uniforms: Record<string, { value: unknown }> = {
          lookup_texture: { value: lookUpTable?.getTexture() ?? nullTexture },
          custom_color_texture: { value: colorTable?.getTexture() ?? nullTexture },
          segmentation_mapping_texture: { value: mappingTable?.getTexture() ?? nullTexture },
        };
        for (const plan of plans) {
          const textures = dataTexturesByLayer.get(plan.name) ?? [];
          const uniformName = `${sanitizeName(plan.name)}_textures`;
          if (avoidSamplerArrays) {
            textures.forEach((texture, i) => {
              uniforms[`${uniformName}_${i}`] = { value: texture };
            });
          } else {
            uniforms[uniformName] = { value: textures };
          }
        }
        const vertexShader = getMainVertexShader(params);
        const fragmentShader = getMainFragmentShader(params);
        const material = new ShaderMaterial({
          uniforms,
          vertexShader: avoidSamplerArrays ? replaceSamplerArrays(vertexShader) : vertexShader,
          fragmentShader: avoidSamplerArrays
            ? replaceSamplerArrays(fragmentShader)
            : fragmentShader,
        });
        material.side = DoubleSide;
        const width = constants.VIEWPORT_WIDTH;
        const geometry = new PlaneGeometry(width, width, PLANE_SUBDIVISION, PLANE_SUBDIVISION);
        mesh = new Mesh(geometry, material);
        const scene = new Scene();
        scene.add(mesh);
        const camera = new OrthographicCamera(
          -width / 2,
          width / 2,
          width / 2,
          -width / 2,
          -1000,
          1000,
        );

        let shaderError: string | null = null;
        renderer.debug.onShaderError = (gl, program, glVertexShader, glFragmentShader) => {
          shaderError = [
            gl.getProgramInfoLog(program),
            gl.getShaderInfoLog(glVertexShader),
            gl.getShaderInfoLog(glFragmentShader),
          ]
            .map((log) => log?.trim())
            .filter((log) => log)
            .join("\n");
        };
        try {
          renderer.compile(scene, camera);
          // three.js checks the link status lazily on first use.
          for (const program of renderer.info.programs ?? []) {
            program.getUniforms();
          }
        } finally {
          renderer.debug.onShaderError = null;
        }
        if (shaderError != null) {
          throw new Error(
            shaderError !== ""
              ? `Shader compilation failed:\n${shaderError}`
              : "Shader compilation failed without an error log. This usually means that the GPU driver crashed.",
          );
        }
        setDetails(`Maximum layer count to render: ${setup.maximumLayerCountToRender}`);
        return { scene, camera };
      },
    );

    await ex.step("Render 3 frames", async () => {
      for (let i = 0; i < 3; i++) {
        renderer.render(scene, camera);
        await nextFrame();
      }
    });
  } finally {
    mesh?.geometry.dispose();
    mesh?.material.dispose();
    for (const textures of dataTexturesByLayer.values()) {
      for (const texture of textures) texture.dispose();
    }
    lookUpTable?.getTexture().dispose();
    colorTable?.getTexture().dispose();
    mappingTable?.getTexture().dispose();
    destroyRenderer();
    canvas.remove();
  }
}

async function runGpuStressTest(ex: ExperimentContext) {
  const gl = await ex.step("Create WebGL context", () => createWebGlContext(ex));
  ex.watchContext(gl);
  const strip = new Uint8Array(STRESS_TEXTURE_WIDTH * 256 * 4).fill(7);
  const textureBytes = STRESS_TEXTURE_WIDTH ** 2 * 4;
  try {
    for (let bytes = textureBytes; bytes <= GPU_STRESS_LIMIT_MB * MB; bytes += textureBytes) {
      await ex.step(
        `Allocate and fill ${STRESS_TEXTURE_WIDTH}² RGBA8 texture (total ${formatMB(bytes)})`,
        () => {
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, STRESS_TEXTURE_WIDTH, STRESS_TEXTURE_WIDTH);
          for (let y = 0; y < STRESS_TEXTURE_WIDTH; y += 256) {
            gl.texSubImage2D(
              gl.TEXTURE_2D,
              0,
              0,
              y,
              STRESS_TEXTURE_WIDTH,
              256,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              strip,
            );
          }
          if (gl.getError() === gl.OUT_OF_MEMORY) {
            throw new Error("The GPU is out of memory.");
          }
        },
      );
    }
  } finally {
    loseContext(gl);
  }
}

function webknossosShaderExperiment(
  id: string,
  label: string,
  layers: SimulatedLayer[],
  { withoutSamplerArrays = false }: { withoutSamplerArrays?: boolean } = {},
): Experiment {
  return {
    id,
    label,
    usesGpu: true,
    // Avoid crashing the GPU again (which makes the browser block WebGL for a while).
    getSkipReason: (results) =>
      !withoutSamplerArrays && areSamplerArraysBroken(results)
        ? "Skipped, since this shader uses sampler arrays, which are known to crash on this device (see the GLSL probes)."
        : null,
    run: (ex) =>
      runShaderSteps(ex, (gl) => {
        const { vertex, fragment } = getWebknossosShaders(layers, readGpuSpecs(gl));
        const sources = getThreeShaderSources(gl, vertex, fragment);
        if (!withoutSamplerArrays) return sources;
        const rewrittenSources = {
          vertex: replaceSamplerArrays(sources.vertex),
          fragment: replaceSamplerArrays(sources.fragment),
        };
        if (rewrittenSources.fragment === sources.fragment) {
          throw new Error("The fragment shader does not contain any sampler arrays.");
        }
        return rewrittenSources;
      }),
  };
}

export const SHADER_PROBE_IDS = SHADER_PROBES.map(({ id }) => `probe-${id}`);

export const SAMPLER_ARRAY_PROBE_IDS = [
  "probe-samplerArraySingle",
  "probe-samplerArrayFloat",
  "probe-samplerArrayUint",
  "probe-samplerArray",
];

// True if sampler arrays break the compilation, while separate samplers work.
export function areSamplerArraysBroken(results: PreviousResults): boolean {
  return (
    SAMPLER_ARRAY_PROBE_IDS.some((id) => results.didFail(id)) &&
    results.didPass("probe-separateSamplers")
  );
}

export const WEBKNOSSOS_SHADER_EXPERIMENT_IDS = {
  color: "wkShader-color",
  segmentation32: "wkShader-segmentation32",
  segmentation64: "wkShader-segmentation64",
  colorAndSegmentation: "wkShader-colorAndSegmentation",
};

export const WORKAROUND_EXPERIMENT_IDS = {
  color: "wkShaderWithoutSamplerArrays-color",
  colorAndSegmentation: "wkShaderWithoutSamplerArrays-colorAndSegmentation",
};

// Ordered from simple to complex. Each experiment uses its own WebGL context, so that a
// crash in one of them does not affect the others.
export const EXPERIMENTS: Experiment[] = [
  {
    id: "environment",
    label: "Environment",
    usesGpu: false,
    run: async (ex) => {
      await ex.step("Collect environment info", (setDetails) =>
        collectEnvironmentInfo().then(setDetails),
      );
    },
  },
  {
    id: "worker",
    label: "Web worker",
    usesGpu: false,
    run: async (ex) => {
      await ex.step("Spawn web worker and run compression", (setDetails) =>
        testWorker().then(setDetails),
      );
    },
  },
  {
    id: "webglInfo",
    label: "WebGL 2 capabilities",
    usesGpu: true,
    run: async (ex) => {
      const gl = await ex.step("Create WebGL context", () => createWebGlContext(ex));
      ex.watchContext(gl);
      try {
        await ex.step("Read limits and extensions", (setDetails) => setDetails(describeWebGl(gl)));
        await ex.step("Compute texture setup like WEBKNOSSOS", (setDetails) => {
          const specs = readGpuSpecs(gl);
          const { plans, setup, requiredBucketCapacity } = planLayers(specs, [
            COLOR_UINT8,
            SEGMENTATION_UINT32,
          ]);
          setDetails(
            [
              `Supported texture size: ${specs.supportedTextureSize}, max texture count: ${specs.maxTextureCount}`,
              `Required bucket capacity: ${requiredBucketCapacity}, supported: ${setup.smallestCommonBucketCapacity}`,
              `Maximum layer count to render: ${setup.maximumLayerCountToRender}`,
              ...plans.map(
                (plan) =>
                  `${plan.name} (${plan.layer.elementClass}): ${plan.textureCount}× ${plan.textureSize}² (${formatMB(getTextureByteSize(plan.textureSize, plan.layer.elementClass))} each)`,
              ),
            ].join("\n"),
          );
        });
      } finally {
        loseContext(gl);
      }
    },
  },
  ...SHADER_PROBES.map(
    (probe): Experiment => ({
      id: `probe-${probe.id}`,
      label: `GLSL probe: ${probe.label}`,
      usesGpu: true,
      run: (ex) => runShaderSteps(ex, () => probe.sources),
    }),
  ),
  // Tests whether avoiding sampler arrays is a viable workaround.
  webknossosShaderExperiment(
    WORKAROUND_EXPERIMENT_IDS.color,
    "WEBKNOSSOS shader without sampler arrays: color layer (uint8)",
    [COLOR_UINT8],
    { withoutSamplerArrays: true },
  ),
  webknossosShaderExperiment(
    WORKAROUND_EXPERIMENT_IDS.colorAndSegmentation,
    "WEBKNOSSOS shader without sampler arrays: color (uint8) and segmentation (uint32) layer",
    [COLOR_UINT8, SEGMENTATION_UINT32],
    { withoutSamplerArrays: true },
  ),
  webknossosShaderExperiment(
    WEBKNOSSOS_SHADER_EXPERIMENT_IDS.color,
    "WEBKNOSSOS shader: color layer (uint8)",
    [COLOR_UINT8],
  ),
  webknossosShaderExperiment(
    WEBKNOSSOS_SHADER_EXPERIMENT_IDS.segmentation32,
    "WEBKNOSSOS shader: segmentation layer (uint32)",
    [SEGMENTATION_UINT32],
  ),
  webknossosShaderExperiment(
    WEBKNOSSOS_SHADER_EXPERIMENT_IDS.segmentation64,
    "WEBKNOSSOS shader: segmentation layer (uint64)",
    [SEGMENTATION_UINT64],
  ),
  webknossosShaderExperiment(
    WEBKNOSSOS_SHADER_EXPERIMENT_IDS.colorAndSegmentation,
    "WEBKNOSSOS shader: color (uint8) and segmentation (uint32) layer",
    [COLOR_UINT8, SEGMENTATION_UINT32],
  ),
  {
    id: "realisticSetup",
    label: "Realistic WEBKNOSSOS setup (textures, tables, shaders via three.js)",
    usesGpu: true,
    run: runRealisticSetup,
  },
  {
    id: "jsMemory",
    label: `JS memory (up to ${JS_MEMORY_LIMIT_MB} MB)`,
    usesGpu: false,
    run: async (ex) => {
      // Released when the experiment is done.
      const heldMemory: Uint8Array[] = [];
      for (let mb = JS_MEMORY_CHUNK_MB; mb <= JS_MEMORY_LIMIT_MB; mb += JS_MEMORY_CHUNK_MB) {
        await ex.step(`Allocate JS memory (total ${mb} MB)`, () => {
          const chunk = new Uint8Array(JS_MEMORY_CHUNK_MB * MB);
          // Write to the memory so that it is actually committed.
          chunk.fill(1);
          heldMemory.push(chunk);
        });
      }
    },
  },
  {
    id: "gpuStress",
    label: `GPU memory (up to ${GPU_STRESS_LIMIT_MB} MB)`,
    usesGpu: true,
    run: runGpuStressTest,
  },
];
