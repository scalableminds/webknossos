import { AbstractCuckooTable } from "libs/cuckoo/abstract_cuckoo_table";
import { CuckooTableUint32 } from "libs/cuckoo/cuckoo_table_uint32";
import { CuckooTableUint64 } from "libs/cuckoo/cuckoo_table_uint64";
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
import { getSupportedTextureSpecs } from "viewer/model/bucket_data_handling/gpu_capability_check";
import { MAPPING_TEXTURE_WIDTH } from "viewer/model/bucket_data_handling/mappings";
import getMainFragmentShader, {
  getMainVertexShader,
  type Params as ShaderParams,
} from "viewer/shaders/main_data_shaders.glsl";
import { createWorker } from "viewer/workers/comlink_wrapper";
import type Compress from "viewer/workers/compress.worker";

// Mirror the constants from layer_rendering_manager.ts
const LOOKUP_CUCKOO_TEXTURE_WIDTH = 256;
const CUSTOM_COLORS_TEXTURE_WIDTH = 512;

const MB = 1024 ** 2;
const JS_MEMORY_CHUNK_MB = 64;
// 4096² RGBA8
const STRESS_TEXTURE_WIDTH = 4096;

const RUN_STORAGE_KEY = "wkDeviceDebugRun";
const CONFIG_STORAGE_KEY = "wkDeviceDebugConfig";

export const STEP_GROUPS = [
  { id: "environment", label: "Collect environment info" },
  { id: "worker", label: "Spawn web worker" },
  { id: "webglProbe", label: "Probe WebGL 2 context" },
  { id: "gpuSpecs", label: "Compute texture setup (like WEBKNOSSOS)" },
  { id: "renderer", label: "Create three.js renderer" },
  { id: "lookupTable", label: "Create bucket lookup table" },
  { id: "dataTextures", label: "Allocate data textures" },
  { id: "uploadData", label: "Upload data to data textures" },
  { id: "colorTable", label: "Create segment color table" },
  { id: "mappingTable", label: "Create mapping table (4096² RGBA32UI)" },
  { id: "shaderCompile", label: "Compile WEBKNOSSOS shaders" },
  { id: "render", label: "Render frames" },
  { id: "jsMemory", label: "Allocate JS memory" },
  { id: "gpuStress", label: "GPU stress test (allocate until limit)" },
] as const;

export type StepGroupId = (typeof STEP_GROUPS)[number]["id"];

export type DebugConfig = {
  gpuMemoryFactor: number;
  colorLayerCount: number;
  colorElementClass: ElementClass;
  segmentationElementClass: ElementClass | "none";
  jsMemoryLimitMB: number;
  gpuStressLimitMB: number;
  // Waiting before each step gives the browser time to persist the progress
  // to localStorage before a potential crash.
  delayMs: number;
  disabledGroups: StepGroupId[];
};

export const DEFAULT_CONFIG: DebugConfig = {
  gpuMemoryFactor: constants.DEFAULT_GPU_MEMORY_FACTOR,
  colorLayerCount: 1,
  colorElementClass: "uint8",
  segmentationElementClass: "uint32",
  jsMemoryLimitMB: 512,
  gpuStressLimitMB: 2048,
  delayMs: 500,
  disabledGroups: ["gpuStress"],
};

export type StepStatus = "running" | "passed" | "failed" | "skipped" | "crashed";

export type StepResult = {
  index: number;
  group: StepGroupId;
  label: string;
  status: StepStatus;
  durationMs?: number;
  details?: string;
  error?: string;
  usedHeapMB?: number;
};

export type RunRecord = {
  startedAt: string;
  finishedAt?: string;
  aborted?: boolean;
  // Set when the page was reopened after the run did not finish.
  crashed?: boolean;
  config: DebugConfig;
  userAgent: string;
  steps: StepResult[];
  // Errors, context losses etc. which happened outside of a step's own error handling.
  events: string[];
};

type LayerPlan = {
  name: string;
  layer: LayerLike;
  textureSize: number;
  textureCount: number;
};

type DebugContext = {
  config: DebugConfig;
  canvas: HTMLCanvasElement;
  specs?: GpuSpecs;
  layerPlans: LayerPlan[];
  maximumLayerCountToRender?: number;
  renderer?: WebGLRenderer;
  lookUpTable?: CuckooTableVec5;
  colorTable?: CuckooTableVec3;
  mappingTable?: CuckooTableUint32 | CuckooTableUint64;
  dataTexturesByLayer: Map<string, UpdatableTexture[]>;
  heldMemory: Uint8Array[];
  stressTextures: UpdatableTexture[];
  scene?: Scene;
  camera?: OrthographicCamera;
  mesh?: Mesh<PlaneGeometry, ShaderMaterial>;
};

export function loadConfig(): DebugConfig {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    return stored != null ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function storeConfig(config: DebugConfig) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function persistRecord(record: RunRecord) {
  try {
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Persisting is best effort (e.g., the quota might be exceeded).
  }
}

// Returns the record of the last run. If that run never finished, the step that
// was running at that time is marked as crashed.
export function loadPreviousRecord(): RunRecord | null {
  try {
    const stored = localStorage.getItem(RUN_STORAGE_KEY);
    if (stored == null) return null;
    const record: RunRecord = JSON.parse(stored);
    if (record.finishedAt == null) {
      record.crashed = true;
      const runningStep = record.steps.find((step) => step.status === "running");
      if (runningStep != null) {
        runningStep.status = "crashed";
        runningStep.error = "The page died while this step was running.";
      } else {
        record.events.push("The page died between two steps.");
      }
      record.finishedAt = "never (crashed)";
      persistRecord(record);
    }
    return record;
  } catch {
    return null;
  }
}

export function clearPreviousRecord() {
  localStorage.removeItem(RUN_STORAGE_KEY);
}

class AbortError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const formatMB = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

function getUsedHeapMB(): number | undefined {
  // performance.memory is only available in Chromium-based browsers.
  const memory = (performance as any).memory;
  return memory != null ? Math.round(memory.usedJSHeapSize / MB) : undefined;
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

function requireRenderer(ctx: DebugContext): WebGLRenderer {
  if (ctx.renderer == null) {
    throw new Error("No renderer available (the renderer step was skipped or failed).");
  }
  return ctx.renderer;
}

// Reading back a pixel forces the GPU to finish all pending work. Otherwise, the
// driver might defer allocations so that a crash would be attributed to a later step.
function syncGpu(renderer: WebGLRenderer): void {
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (gl.isContextLost()) {
    throw new Error("The WebGL context was lost.");
  }
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`WebGL error ${error} (0x${error.toString(16)})`);
  }
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

function getSimulatedLayers(config: DebugConfig): Array<{ name: string; layer: LayerLike }> {
  const layers: Array<{ name: string; layer: LayerLike }> = [];
  for (let i = 0; i < config.colorLayerCount; i++) {
    layers.push({
      name: `color_${i}`,
      layer: {
        elementClass: config.colorElementClass,
        category: "color",
        boundingBox: { depth: 1024 },
        additionalAxes: null,
      },
    });
  }
  if (config.segmentationElementClass !== "none") {
    layers.push({
      name: "segmentation",
      layer: {
        elementClass: config.segmentationElementClass,
        category: "segmentation",
        boundingBox: { depth: 1024 },
        additionalAxes: null,
      },
    });
  }
  return layers;
}

function getShaderParams(ctx: DebugContext): ShaderParams {
  // Only compile as many layers as the GPU supports (see PlaneMaterialFactory.getLayersToRender).
  const renderedPlans = ctx.layerPlans.slice(0, ctx.maximumLayerCountToRender);
  const colorLayerNames = renderedPlans
    .filter((plan) => plan.layer.category === "color")
    .map((plan) => sanitizeName(plan.name));
  const segmentationLayerNames = renderedPlans
    .filter((plan) => plan.layer.category === "segmentation")
    .map((plan) => sanitizeName(plan.name));
  const textureLayerInfos: ShaderParams["textureLayerInfos"] = {};
  for (const plan of ctx.layerPlans) {
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
    globalLayerCount: ctx.layerPlans.length,
    colorLayerNames,
    orderedColorLayerNames: colorLayerNames,
    segmentationLayerNames,
    textureLayerInfos,
    // Assume 8 magnifications per layer.
    magnificationsCount: 8 * ctx.layerPlans.length,
    voxelSizeFactor: [11, 11, 24],
    voxelSizeFactorInverted: [1 / 11, 1 / 11, 1 / 24],
    isOrthogonal: true,
    useInterpolation: false,
    tpsTransformPerLayer: {},
    isWindows: false,
  };
}

function getTextureUniforms(ctx: DebugContext): Record<string, { value: unknown }> {
  const nullTexture = AbstractCuckooTable.getNullTexture();
  const uniforms: Record<string, { value: unknown }> = {
    lookup_texture: { value: ctx.lookUpTable?.getTexture() ?? nullTexture },
    custom_color_texture: { value: ctx.colorTable?.getTexture() ?? nullTexture },
    segmentation_mapping_texture: { value: ctx.mappingTable?.getTexture() ?? nullTexture },
  };
  for (const plan of ctx.layerPlans) {
    uniforms[`${sanitizeName(plan.name)}_textures`] = {
      value: ctx.dataTexturesByLayer.get(plan.name) ?? [],
    };
  }
  return uniforms;
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

function probeWebGl(): string {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (gl == null) {
    throw new Error("WebGL 2 is not supported.");
  }
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
  const lines = [
    `Vendor: ${debugInfo != null ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)}`,
    `Renderer: ${debugInfo != null ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`,
    `Version: ${gl.getParameter(gl.VERSION)}`,
    `GLSL: ${gl.getParameter(gl.SHADING_LANGUAGE_VERSION)}`,
    ...parameterNames.map((name) => `${name}: ${String(gl.getParameter(gl[name]))}`),
    `High precision float in fragment shader: ${gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision}`,
    `High precision int in fragment shader: ${gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_INT)?.rangeMax}`,
    `Extensions: ${(gl.getSupportedExtensions() ?? []).join(", ")}`,
  ];
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return lines.join("\n");
}

export async function runDebugSteps(
  config: DebugConfig,
  canvas: HTMLCanvasElement,
  onUpdate: (record: RunRecord) => void,
  shouldAbort: () => boolean,
): Promise<void> {
  const record: RunRecord = {
    startedAt: new Date().toISOString(),
    config,
    userAgent: navigator.userAgent,
    steps: [],
    events: [],
  };
  const update = () => {
    persistRecord(record);
    onUpdate({ ...record, steps: [...record.steps], events: [...record.events] });
  };
  const ctx: DebugContext = {
    config,
    canvas,
    layerPlans: [],
    dataTexturesByLayer: new Map(),
    heldMemory: [],
    stressTextures: [],
  };
  const isEnabled = (group: StepGroupId) => !config.disabledGroups.includes(group);

  const onError = (event: ErrorEvent) => {
    record.events.push(`Uncaught error: ${event.message}`);
    update();
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    record.events.push(`Unhandled rejection: ${String(event.reason)}`);
    update();
  };
  const onContextLost = () => {
    record.events.push(`WebGL context lost (during step ${record.steps.length}).`);
    update();
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  canvas.addEventListener("webglcontextlost", onContextLost);

  // Returns false if the step failed.
  const step = async (
    group: StepGroupId,
    label: string,
    fn: () => Promise<string | void> | string | void,
  ): Promise<boolean> => {
    if (shouldAbort()) throw new AbortError();
    if (!isEnabled(group)) {
      // Groups with multiple steps only get a single entry when skipped.
      const previousStep = record.steps.at(-1);
      if (previousStep?.group !== group) {
        const groupLabel = STEP_GROUPS.find(({ id }) => id === group)?.label ?? label;
        record.steps.push({
          index: record.steps.length + 1,
          group,
          label: groupLabel,
          status: "skipped",
        });
        update();
      }
      return true;
    }
    const result: StepResult = { index: record.steps.length + 1, group, label, status: "running" };
    record.steps.push(result);
    update();
    // Give the UI a chance to render and the browser a chance to persist the record.
    await nextFrame();
    await sleep(config.delayMs);
    const startTime = performance.now();
    try {
      const details = await fn();
      if (ctx.renderer != null) {
        syncGpu(ctx.renderer);
      }
      result.status = "passed";
      result.details = details ?? undefined;
    } catch (error) {
      result.status = "failed";
      result.error = error instanceof Error ? error.message : String(error);
    }
    result.durationMs = Math.round(performance.now() - startTime);
    result.usedHeapMB = getUsedHeapMB();
    update();
    return result.status === "passed";
  };

  try {
    await step("environment", "Collect environment info", collectEnvironmentInfo);
    await step("worker", "Spawn web worker and run compression", testWorker);

    await step(
      "webglProbe",
      "Create WebGL 2 context on a fresh canvas and read limits",
      probeWebGl,
    );

    await step("gpuSpecs", "Compute texture setup like WEBKNOSSOS", () => {
      ctx.specs = getSupportedTextureSpecs();
      const layers = getSimulatedLayers(config);
      const requiredBucketCapacity = constants.GPU_FACTOR_MULTIPLIER * config.gpuMemoryFactor;
      const setup = computeDataTexturesSetup(
        ctx.specs,
        layers.map(({ layer }) => layer),
        config.segmentationElementClass !== "none",
        requiredBucketCapacity,
      );
      ctx.maximumLayerCountToRender = setup.maximumLayerCountToRender;
      ctx.layerPlans = layers.map(({ name, layer }) => {
        const info = setup.textureInformationPerLayer.get(layer);
        if (info == null) throw new Error(`No texture information for ${name}`);
        return { name, layer, textureSize: info.textureSize, textureCount: info.textureCount };
      });
      const totalBytes = ctx.layerPlans.reduce(
        (sum, plan) =>
          sum + plan.textureCount * getTextureByteSize(plan.textureSize, plan.layer.elementClass),
        0,
      );
      return [
        `Supported texture size: ${ctx.specs.supportedTextureSize}, max texture count: ${ctx.specs.maxTextureCount}`,
        `Required bucket capacity: ${requiredBucketCapacity}, supported: ${setup.smallestCommonBucketCapacity}`,
        `Maximum layer count to render: ${setup.maximumLayerCountToRender}`,
        ...ctx.layerPlans.map(
          (plan) =>
            `${plan.name} (${plan.layer.elementClass}): ${plan.textureCount}× ${plan.textureSize}² (${formatMB(getTextureByteSize(plan.textureSize, plan.layer.elementClass))} each)`,
        ),
        `Total data texture memory: ${formatMB(totalBytes)}`,
      ].join("\n");
    });

    await step("renderer", "Create three.js WebGLRenderer (like WEBKNOSSOS)", () => {
      // getRenderer uses the canvas with the id render-canvas.
      const renderer = getRenderer();
      const gl = typeof renderer.getContext === "function" ? renderer.getContext() : null;
      if (gl == null || gl.isContextLost()) {
        throw new Error("Could not create a WebGL context for the renderer.");
      }
      // Like WEBKNOSSOS, ignore the devicePixelRatio.
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      ctx.renderer = renderer;
      return `Canvas size: ${canvas.width}×${canvas.height}`;
    });

    await step(
      "lookupTable",
      `Create bucket lookup table (${LOOKUP_CUCKOO_TEXTURE_WIDTH}² RGBA32UI)`,
      () => {
        requireRenderer(ctx);
        ctx.lookUpTable = new CuckooTableVec5(LOOKUP_CUCKOO_TEXTURE_WIDTH);
      },
    );

    for (const plan of ctx.layerPlans) {
      const textures: UpdatableTexture[] = [];
      ctx.dataTexturesByLayer.set(plan.name, textures);
      const size = formatMB(getTextureByteSize(plan.textureSize, plan.layer.elementClass));
      for (let i = 0; i < plan.textureCount; i++) {
        await step(
          "dataTextures",
          `Allocate data texture ${i + 1}/${plan.textureCount} for ${plan.name} (${plan.textureSize}², ${plan.layer.elementClass}, ${size})`,
          () => {
            textures.push(
              allocateTexture(requireRenderer(ctx), plan.textureSize, plan.layer.elementClass),
            );
          },
        );
      }
    }

    for (const plan of ctx.layerPlans) {
      const textures = ctx.dataTexturesByLayer.get(plan.name) ?? [];
      for (let i = 0; i < plan.textureCount; i++) {
        await step(
          "uploadData",
          `Upload data to texture ${i + 1}/${plan.textureCount} of ${plan.name}`,
          () => {
            if (textures[i] == null) throw new Error("Texture was not allocated.");
            fillTexture(textures[i], plan.textureSize, plan.layer.elementClass);
          },
        );
      }
    }

    const hasSegmentation = config.segmentationElementClass !== "none";
    if (hasSegmentation) {
      await step(
        "colorTable",
        `Create segment color table (${CUSTOM_COLORS_TEXTURE_WIDTH}² RGBA32UI)`,
        () => {
          requireRenderer(ctx);
          ctx.colorTable = new CuckooTableVec3(CUSTOM_COLORS_TEXTURE_WIDTH);
        },
      );
      const is64Bit =
        config.segmentationElementClass === "uint64" || config.segmentationElementClass === "int64";
      const mappingTextureBytes = MAPPING_TEXTURE_WIDTH ** 2 * 16;
      await step(
        "mappingTable",
        `Create ${is64Bit ? "64" : "32"}-bit mapping table (${MAPPING_TEXTURE_WIDTH}² RGBA32UI, ${formatMB(mappingTextureBytes)} CPU + ${formatMB(mappingTextureBytes)} GPU)`,
        () => {
          requireRenderer(ctx);
          // WEBKNOSSOS always creates this table when the dataset has a segmentation layer
          // (see PlaneMaterialFactory.attachSegmentationMappingTextures).
          ctx.mappingTable = is64Bit
            ? new CuckooTableUint64(MAPPING_TEXTURE_WIDTH)
            : new CuckooTableUint32(MAPPING_TEXTURE_WIDTH);
        },
      );
    }

    await step("shaderCompile", "Generate and compile WEBKNOSSOS plane shaders", () => {
      const renderer = requireRenderer(ctx);
      if (ctx.layerPlans.length === 0) {
        throw new Error("No layer plan available (the texture setup step was skipped or failed).");
      }
      const shaderParams = getShaderParams(ctx);
      const vertexShader = getMainVertexShader(shaderParams);
      const fragmentShader = getMainFragmentShader(shaderParams);
      const material = new ShaderMaterial({
        uniforms: getTextureUniforms(ctx),
        vertexShader,
        fragmentShader,
      });
      material.side = DoubleSide;
      const width = constants.VIEWPORT_WIDTH;
      const geometry = new PlaneGeometry(width, width, PLANE_SUBDIVISION, PLANE_SUBDIVISION);
      ctx.mesh = new Mesh(geometry, material);
      ctx.scene = new Scene();
      ctx.scene.add(ctx.mesh);
      ctx.camera = new OrthographicCamera(
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
        ].join("\n");
      };
      try {
        renderer.compile(ctx.scene, ctx.camera);
        // three.js checks the link status lazily on first use.
        for (const program of renderer.info.programs ?? []) {
          program.getUniforms();
        }
      } finally {
        renderer.debug.onShaderError = null;
      }
      if (shaderError != null) {
        throw new Error(`Shader compilation failed:\n${shaderError}`);
      }
      return `Vertex shader: ${vertexShader.length} chars, fragment shader: ${fragmentShader.length} chars`;
    });

    await step("render", "Render 3 frames with the WEBKNOSSOS shader", async () => {
      const renderer = requireRenderer(ctx);
      if (ctx.scene == null || ctx.camera == null) {
        throw new Error("No scene available (the shader step was skipped or failed).");
      }
      for (let i = 0; i < 3; i++) {
        renderer.render(ctx.scene, ctx.camera);
        await nextFrame();
      }
    });

    for (let mb = JS_MEMORY_CHUNK_MB; mb <= config.jsMemoryLimitMB; mb += JS_MEMORY_CHUNK_MB) {
      const succeeded = await step("jsMemory", `Allocate JS memory (total ${mb} MB)`, () => {
        const chunk = new Uint8Array(JS_MEMORY_CHUNK_MB * MB);
        // Write to the memory so that it is actually committed.
        chunk.fill(1);
        ctx.heldMemory.push(chunk);
      });
      if (!succeeded) break;
    }
    // The garbage collector might free this memory only later.
    await step("jsMemory", "Release JS memory", () => {
      ctx.heldMemory = [];
    });

    const stressTextureBytes = getTextureByteSize(STRESS_TEXTURE_WIDTH, "uint8");
    for (
      let bytes = stressTextureBytes;
      bytes <= config.gpuStressLimitMB * MB;
      bytes += stressTextureBytes
    ) {
      const succeeded = await step(
        "gpuStress",
        `Allocate and fill additional ${STRESS_TEXTURE_WIDTH}² RGBA8 texture (total ${formatMB(bytes)})`,
        () => {
          const texture = allocateTexture(requireRenderer(ctx), STRESS_TEXTURE_WIDTH, "uint8");
          ctx.stressTextures.push(texture);
          fillTexture(texture, STRESS_TEXTURE_WIDTH, "uint8");
        },
      );
      if (!succeeded || !isEnabled("gpuStress")) break;
    }
  } catch (error) {
    if (!(error instanceof AbortError)) throw error;
    record.aborted = true;
  } finally {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    cleanUp(ctx);
    record.finishedAt = new Date().toISOString();
    update();
  }
}

function cleanUp(ctx: DebugContext) {
  ctx.mesh?.geometry.dispose();
  ctx.mesh?.material.dispose();
  for (const textures of ctx.dataTexturesByLayer.values()) {
    for (const texture of textures) texture.dispose();
  }
  for (const texture of ctx.stressTextures) texture.dispose();
  ctx.lookUpTable?.getTexture().dispose();
  ctx.colorTable?.getTexture().dispose();
  ctx.mappingTable?.getTexture().dispose();
  ctx.heldMemory = [];
  destroyRenderer();
}
