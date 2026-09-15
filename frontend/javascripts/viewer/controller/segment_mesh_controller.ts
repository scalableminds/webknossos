import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import { computeBvhAsync } from "libs/compute_bvh_async";
import forEach from "lodash-es/forEach";
import get from "lodash-es/get";
import isEqual from "lodash-es/isEqual";
import setWith from "lodash-es/setWith";
import throttle from "lodash-es/throttle";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FrontSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Vector3 as ThreeVector3,
} from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import TWEEN from "tween.js";
import type { AdditionalCoordinate } from "types/api_types";
import type { BigIntAsKey, LayerNameAsKey } from "types/type_utils";
import type { Vector2, Vector3 } from "viewer/constants";
import Constants from "viewer/constants";
import CustomLOD from "viewer/controller/custom_lod";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  getActiveSegmentationTracing,
  getActiveUnmappedSegmentId,
  getSegmentColorAsHSLA,
} from "viewer/model/accessors/volumetracing_accessor";
import { NO_LOD_MESH_INDEX } from "viewer/model/sagas/meshes/common_mesh_saga";
import Store, { MinCutPartitionKeys, type MinCutPartitions } from "viewer/store";
import type { BufferGeometryWithInfo } from "./mesh_helpers";

// Add the raycast function. Assumes the BVH is available on
// the `boundsTree` variable
Mesh.prototype.raycast = acceleratedRaycast;

const hslToSRGB = (hsl: Vector3) => new Color().setHSL(...hsl).convertSRGBToLinear();

const WHITE = new Color(1, 1, 1);
const ACTIVATED_COLOR = hslToSRGB([0.7, 0.9, 0.75]);
export const PARTITION_COLORS = {
  partitionA: [0.2, 0.2, 0.2] as Vector3,
  partitionB: [0.7, 0.7, 0.7] as Vector3,
};
const ACTIVATED_COLOR_VEC3 = ACTIVATED_COLOR.toArray() as Vector3;
// Still used for the proofreading-only case where just part of a merged, multi-segment
// mesh is hovered (see updateMeshAppearance) - a specific sub-range can only be
// distinguished by recoloring it, since a light can't target part of one mesh object.
const HOVERED_COLOR_VEC3 = hslToSRGB([0.65, 0.9, 0.75]).toArray() as Vector3;
// Used to give a hovered mesh a glow instead of recoloring it (see updateMeshAppearance):
// tried scoping an extra light to just the hovered mesh via a dedicated three.js render
// layer first, but Light.layers only gates whether a light is active for the *camera*
// (light.layers.test(camera.layers)) - it doesn't test a light against each individual
// mesh's own layers, so it can't target one specific mesh within a single render pass
// (the true "selective lighting" example does this via multiple render passes per
// frame, toggling the camera's layers each time, which isn't worth the extra cost of a
// 5th full-scene render pass just for a hover effect here). emissive is a genuine
// per-mesh material property instead, so it doesn't have that problem.
//
// The glow is tinted with the segment's own color, which means a dark/muddy color
// (e.g. #0000bd - fully saturated, but not very light) barely shows it: a dark tint
// added on top of an already-dark surface stays dark. getHoverGlowColor below brightens
// and re-saturates that tint - and boosts its intensity - proportionally to how far the
// color already is from looking vivid, so an already-bright/saturated color (which
// already pops on hover) is left close to untouched.
const HOVER_GLOW_TARGET_LIGHTNESS = 0.65;
const HOVER_GLOW_TARGET_SATURATION = 0.8;
const HOVER_GLOW_MAX_LIGHTNESS_BLEND = 0.85;
const HOVER_GLOW_MAX_SATURATION_BLEND = 0.5;
const HOVER_EMISSIVE_INTENSITY_BASE = 0.3;
const HOVER_EMISSIVE_INTENSITY_DARK_BONUS = 0.45;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const getHoverGlowColor = (originalColor: Vector3): { color: Color; darkness: number } => {
  // originalColor is stored in linear space (see getColorObjectForSegment); undo that
  // to get the perceptual HSL values matching how the color would read as a hex code.
  const srgbColor = new Color(...originalColor).convertLinearToSRGB();
  const hsl = { h: 0, s: 0, l: 0 };
  srgbColor.getHSL(hsl);

  // 0 once the color is already at/above the target lightness/saturation, ramping up to
  // 1 the darker/duller it is.
  const darkness = clamp01(1 - hsl.l / HOVER_GLOW_TARGET_LIGHTNESS);
  const dullness = clamp01(1 - hsl.s / HOVER_GLOW_TARGET_SATURATION);

  const boostedLightness =
    hsl.l + (HOVER_GLOW_TARGET_LIGHTNESS - hsl.l) * darkness * HOVER_GLOW_MAX_LIGHTNESS_BLEND;
  const boostedSaturation =
    hsl.s + (HOVER_GLOW_TARGET_SATURATION - hsl.s) * dullness * HOVER_GLOW_MAX_SATURATION_BLEND;

  const color = new Color().setHSL(hsl.h, boostedSaturation, boostedLightness);
  color.convertSRGBToLinear();
  return { color, darkness };
};

type MeshMaterial = MeshPhysicalMaterial & { originalColor: Vector3 };
type HighlightEntry = { range: Vector2; color?: Vector3 };
type HighlightState = HighlightEntry[] | "full" | null;
export type MeshSceneNode = Mesh<BufferGeometryWithInfo, MeshMaterial> & {
  hoveredState?: HighlightState;
  activeState?: HighlightState;
  partitionedState?: HighlightState;
  parent: SceneGroupForMeshes;
  isMerged: boolean;
};
export type SceneGroupForMeshes = Group & { segmentId: bigint; children: MeshSceneNode[] };

const setRangeToColor = (
  geometry: BufferGeometryWithInfo,
  indexRange: Vector2 | null,
  color: Vector3,
) => {
  if (indexRange == null) {
    indexRange = [0, geometry.attributes.color.count];
  }
  const colorAttribute = geometry.attributes.color as BufferAttribute;
  for (let index = indexRange[0]; index < indexRange[1]; index++) {
    colorAttribute.set(color, 3 * index);
  }
  // Register the touched range so that the next needsUpdate only pushes
  // this range to the GPU instead of the full color attribute.
};

type GroupForLOD = Group & {
  children: SceneGroupForMeshes[];
  forEach: (callback: (el: SceneGroupForMeshes) => void) => void;
};

export default class SegmentMeshController {
  lightsGroup: Group;
  // meshesLayerLODRootGroup holds a CustomLOD for each segmentation layer with meshes.
  // Each CustomLOD group can hold multiple meshes.
  // meshesLayerLODRootGroup
  // - layer 1
  //  - CustomLOD
  //    - LOD X
  //      - meshes
  // - layer 2
  //  - CustomLOD
  //    - LOD X
  //      - meshes
  meshesLayerLODRootGroup: Group;

  meshesGroupsPerSegmentId: Record<
    string, // additionalCoordinatesString
    Record<
      LayerNameAsKey,
      Record<
        BigIntAsKey, // segmentId.toString()
        Record<
          number, // level of detail (LOD)
          GroupForLOD
        >
      >
    >
  > = {};

  constructor() {
    this.lightsGroup = new Group();
    this.meshesLayerLODRootGroup = new Group();
    this.addLights();
  }

  hasMesh(
    id: bigint,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): boolean {
    return (
      this.getMeshGroups(getAdditionalCoordinatesAsString(additionalCoordinates), layerName, id) !=
      null
    );
  }

  async addMeshFromVerticesAsync(
    vertices: Float32Array,
    segmentId: bigint,
    layerName: string,
    opacity: number | undefined,
    additionalCoordinates?: AdditionalCoordinate[] | undefined | null,
  ): Promise<void> {
    // Currently, this function is only used by ad hoc meshing.
    if (vertices.length === 0) return;
    let bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new BufferAttribute(vertices, 3));

    bufferGeometry = mergeVertices(bufferGeometry);
    bufferGeometry.computeVertexNormals();

    bufferGeometry.boundsTree = await computeBvhAsync(bufferGeometry);

    this.addMeshFromGeometry(
      bufferGeometry as BufferGeometryWithInfo,
      segmentId,
      null,
      NO_LOD_MESH_INDEX,
      layerName,
      additionalCoordinates,
      opacity,
      false,
    );
  }

  constructMesh(
    segmentId: bigint,
    layerName: string,
    geometry: BufferGeometryWithInfo,
    opacity: number | undefined,
    isMerged: boolean,
  ): MeshSceneNode {
    const color = this.getColorObjectForSegment(segmentId, layerName);
    const meshMaterial = new MeshPhysicalMaterial({
      vertexColors: true,
      // A mid-range roughness gives the mesh a soft specular highlight (unlike the
      // purely-diffuse Lambert material used previously), which helps the eye read
      // curved/cylindrical surfaces like dendrites as three-dimensional. Lower than
      // 0.5 starts looking noticeably glossy/plastic; higher spreads the highlight so
      // thin it barely reads, which was contributing to the overall dark/flat look.
      roughness: 0.45,
      metalness: 0.05,
      // Sheen adds a rim-light glint at grazing angles, e.g. along silhouette edges
      // where branches overlap. A moderate/broad sheen visibly washes the segment's own
      // color out (it layers a white lobe over it), so this is intentionally low, and
      // sheenRoughness is kept low too so the lobe stays narrow/grazing-only rather than
      // spreading across most of the visible, front-facing surface.
      sheen: 0.2,
      sheenRoughness: 0.25,
      sheenColor: WHITE,
      // A thin, glossy clearcoat layer on top of the base material - reads as a "wet
      // tissue" look, and gives a second, tighter specular highlight independent of the
      // (fairly soft) base roughness above. Unlike sheen, clearcoat's reflectance is
      // Fresnel-based and close to colorless, concentrated in a sharp highlight rather
      // than broadly tinting the diffuse color, so it doesn't reintroduce the washed-out
      // look sheen caused at higher values.
      clearcoat: 0.05,
      clearcoatRoughness: 0.1,
    }) as MeshMaterial;
    meshMaterial.side = FrontSide;
    meshMaterial.transparent = true;
    const colorArray = color.convertSRGBToLinear().toArray() as Vector3;
    meshMaterial.originalColor = colorArray;

    // Theoretically, this is not necessary for meshes that don't need non-uniform
    // colors, but measurements showed that this only takes up ~0.03 ms per mesh
    // (initialization, at least). We can optimize this later if necessary.
    const colorBuffer = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      colorBuffer.set(colorArray, i * 3);
    }
    geometry.setAttribute("color", new BufferAttribute(colorBuffer, 3));

    // mesh.parent is still null at this moment, but when the mesh is
    // added to the group later, parent will be set. We'll ignore
    // this detail for now via the casting.
    const mesh = new Mesh(geometry, meshMaterial) as any as MeshSceneNode;
    mesh.isMerged = isMerged;

    const tweenAnimation = new TWEEN.Tween({
      opacity: 0,
    });
    tweenAnimation
      .to(
        {
          opacity: opacity ?? Constants.DEFAULT_MESH_OPACITY,
        },
        100,
      )
      .onUpdate(function onUpdate(this: { opacity: number }) {
        meshMaterial.opacity = this.opacity;
        app.vent.emit("rerender");
      })
      .start();

    return mesh;
  }

  addMeshFromGeometry(
    geometry: BufferGeometryWithInfo,
    segmentId: bigint,
    scale: Vector3 | null = null,
    lod: number,
    layerName: string,
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
    opacity: number | undefined,
    isMerged: boolean,
  ): void {
    const additionalCoordinatesString = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordinatesString, layerName, segmentId.toString(), lod];
    const isNewlyAddedMesh = get(this.meshesGroupsPerSegmentId, keys) == null;
    const targetGroup: SceneGroupForMeshes = get(this.meshesGroupsPerSegmentId, keys, new Group());
    setWith(this.meshesGroupsPerSegmentId, keys, targetGroup, Object);
    let layerLODGroup = this.meshesLayerLODRootGroup.getObjectByName(layerName) as
      | CustomLOD
      | undefined;

    if (layerLODGroup == null) {
      layerLODGroup = new CustomLOD();
      layerLODGroup.name = layerName;
      this.meshesLayerLODRootGroup.add(layerLODGroup);
    }

    if (isNewlyAddedMesh) {
      if (lod === NO_LOD_MESH_INDEX) {
        layerLODGroup.addNoLODSupportedMesh(targetGroup);
      } else {
        layerLODGroup.addLODMesh(targetGroup, lod);
      }
      targetGroup.segmentId = segmentId;
      const dsScaleFactor = Store.getState().dataset.dataSource.scale.factor;
      // If the mesh was calculated on a different magnification level,
      // the backend sends the scale factor of this magnification.
      // As the meshesLODRootGroup is already scaled by the main rootGroup,
      // this portion of the scale needs to be taken out of the scale applied to the mesh.
      // If no scale was given, the meshes coordinates are already in scale of dataset and
      // thus the scaling done by the root group needs to be unscaled (done by 1/dsScaleFactor).
      scale = scale || [1, 1, 1];
      const adaptedScale = [
        scale[0] / dsScaleFactor[0],
        scale[1] / dsScaleFactor[1],
        scale[2] / dsScaleFactor[2],
      ];
      targetGroup.scale.copy(new ThreeVector3(...adaptedScale));
    }
    const meshChunk = this.constructMesh(segmentId, layerName, geometry, opacity, isMerged);

    const group = new Group() as SceneGroupForMeshes;
    group.add(meshChunk);

    group.segmentId = segmentId;
    this.addMeshToMeshGroups(additionalCoordinatesString, layerName, segmentId, lod, group);

    const state = Store.getState();
    if (isNewlyAddedMesh) {
      const isVisible =
        state.localSegmentationStateByLayer?.[layerName]?.meshes?.[additionalCoordinatesString]?.[
          segmentId.toString()
        ].isVisible ?? true;
      this.setMeshVisibility(segmentId, isVisible, layerName, additionalCoordinates);
    }

    const segmentationTracing = getActiveSegmentationTracing(state);
    if (segmentationTracing != null) {
      // addMeshFromGeometry is often called multiple times for different sets of geometries.
      // Therefore, used a throttled variant of the updateActiveUnmappedSegmentIdHighlighting method.
      this.throttledUpdateActiveUnmappedSegmentIdHighlighting(
        getActiveUnmappedSegmentId(state, segmentationTracing),
      );
      // Re-apply the multi-split partition highlighting for the (re)created mesh.
      // Needed in case the mesh is reloaded due to e.g. incorporating foreign update actions.
      if (state.uiInformation.activeTool === AnnotationTool.PROOFREAD) {
        this.throttledUpdateMinCutPartitionHighlighting(
          state.localSegmentationStateByLayer[segmentationTracing.tracingId]?.minCutPartitions ??
            null,
        );
      }
    }
  }

  removeMeshById(
    segmentId: bigint,
    layerName: string,
    options?: {
      lod?: number;
      // If additionalCoordinates is not passed, the current additional
      // coordinates of the flycam are used. Pass them explicitly to remove
      // meshes that were loaded under other additional coordinates.
      additionalCoordinates?: AdditionalCoordinate[] | null;
    },
  ): void {
    const additionalCoordinates =
      options?.additionalCoordinates !== undefined
        ? options.additionalCoordinates
        : Store.getState().flycam.additionalCoordinates;
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const meshGroups = this.getMeshGroups(additionalCoordKey, layerName, segmentId);
    const lodMeshGroupForLayer = this.getLODGroupOfLayer(layerName);
    if (lodMeshGroupForLayer == null) {
      // No meshes for this layer
      return;
    }

    if (meshGroups == null) {
      return;
    }

    forEach(meshGroups, (meshGroup, lodStr) => {
      const currentLod = Number.parseInt(lodStr, 10);

      if (options?.lod != null && currentLod !== options.lod) {
        // If options.lod is provided, only remove that LOD.
        return;
      }

      if (currentLod !== NO_LOD_MESH_INDEX) {
        lodMeshGroupForLayer.removeLODMesh(meshGroup, currentLod);
      } else {
        lodMeshGroupForLayer.removeNoLODSupportedMesh(meshGroup);
      }
      this.disposeMeshGroup(meshGroup);

      this.removeMeshLODFromMeshGroups(additionalCoordKey, layerName, segmentId, currentLod);
    });
    if (options?.lod == null) {
      // If options.lod is provided, the parent group should not be removed
      this.removeMeshFromMeshGroups(additionalCoordKey, layerName, segmentId);
    }
  }

  private disposeMeshGroup(meshGroup: Group): void {
    // Without explicit disposal, three.js would keep the GPU buffers of the
    // geometries and materials alive even though the meshes were removed
    // from the scene graph.
    meshGroup.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
  }

  getMeshGeometryInBestLOD(
    segmentId: bigint,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): Group | null {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const meshGroups = this.getMeshGroups(additionalCoordKey, layerName, segmentId);

    if (meshGroups == null) return null;

    const bestLod = Math.min(
      ...Object.keys(meshGroups).map((lodVal) => Number.parseInt(lodVal, 10)),
    );

    return this.getMeshGroupsByLOD(additionalCoordinates, layerName, segmentId, bestLod);
  }

  setMeshVisibility(
    id: bigint,
    visibility: boolean,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): void {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    forEach(this.getMeshGroups(additionalCoordKey, layerName, id), (meshGroup) => {
      meshGroup.visible = visibility;
    });
  }

  getLODGroupOfLayer(layerName: string): CustomLOD | undefined {
    return this.meshesLayerLODRootGroup.getObjectByName(layerName) as CustomLOD | undefined;
  }

  setVisibilityOfMeshesOfLayer(layerName: string, visibility: boolean): void {
    const layerLODGroup = this.meshesLayerLODRootGroup.getObjectByName(layerName) as
      | CustomLOD
      | undefined;
    if (layerLODGroup != null) {
      layerLODGroup.visible = visibility;
    }
  }

  applyOnMeshGroupChildren = (
    layerName: string,
    segmentId: bigint,
    functionToApply: (child: MeshSceneNode) => void,
  ) => {
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentId)) {
      const meshDataForOneSegment = recordsOfLayers[layerName][segmentId.toString()];
      if (meshDataForOneSegment != null) {
        for (const lodGroup of Object.values(meshDataForOneSegment)) {
          for (const meshGroup of lodGroup.children) {
            meshGroup.children.forEach(functionToApply);
          }
        }
      }
    }
  };

  setMeshColor(id: bigint, layerName: string, opacity?: number): void {
    const color = this.getColorObjectForSegment(id, layerName);
    const colorArray = color.toArray() as Vector3;
    // If in nd-dataset, set the color for all additional coordinates
    this.applyOnMeshGroupChildren(layerName, id, (child: MeshSceneNode) => {
      child.material.originalColor = colorArray;
      if (child.material.vertexColors) {
        setRangeToColor(child.geometry, null, colorArray);
        child.geometry.attributes.color.needsUpdate = true;
      } else {
        child.material.color = color;
      }

      if (opacity != null) child.material.opacity = opacity;
    });
  }

  setMeshOpacity(id: bigint, layerName: string, opacity: number): void {
    // If in nd-dataset, set the opacity for all additional coordinates
    this.applyOnMeshGroupChildren(layerName, id, (child: MeshSceneNode) => {
      child.material.opacity = opacity;
    });
  }

  getColorObjectForSegment(segmentId: bigint, layerName: string) {
    const [hue, saturation, light] = getSegmentColorAsHSLA(Store.getState(), segmentId, layerName);
    // Previously pulled saturation/lightness in a bit here to leave headroom for the
    // material's shading, but the lighting/material tuning above turned out to give
    // plenty of shading on its own - so the segment's actual color (also used for the
    // 2D view, via getSegmentColorAsHSLA) is used as-is instead of a muted version of it.
    const color = new Color().setHSL(hue, saturation, light);
    color.convertSRGBToLinear();

    return color;
  }

  addLights(): void {
    // Note that the PlaneView also attaches a key/fill light pair directly to the TD
    // camera, so that light always moves along with the current viewing angle. The
    // lights added here stay fixed in world space and are only meant to keep the
    // mesh from ever going fully unlit/black, not to provide the main shading —
    // having many lights of similar intensity coming from (almost) every direction
    // (the previous approach) cancels out the shading gradients that make a surface
    // read as three-dimensional, so we deliberately keep this to a low-intensity
    // ambient plus two faint, distinctly-colored world-space lights instead. Kept
    // deliberately low: unlike the key/fill pair, ambient has no direction, so raising
    // it lifts the darkest areas without adding any shading gradient of their own — it
    // was raised once already to fix a too-dark far side, but that just made things
    // look flat/featureless instead, so PlaneView's fill light intensity is what
    // actually carries that job now.
    const ambientLight = new AmbientLight("white", 0.2);
    this.lightsGroup.add(ambientLight);

    // Subtle, cool-toned rim/back light so overlapping branches keep an edge of
    // separation even when the camera-attached key light above is grazing or
    // pointing away from them.
    const rimLight = new DirectionalLight(0xcfe0ff, 0.5);
    rimLight.position.set(-1, 0.5, -1).normalize();
    this.lightsGroup.add(rimLight);

    // Faint, warm-toned bounce light from below so undersides never go pure black.
    const bounceLight = new DirectionalLight(0xffe9cf, 0.2);
    bounceLight.position.set(0.4, -1, 0.5).normalize();
    this.lightsGroup.add(bounceLight);
  }

  private getMeshGroupsByLOD(
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
    layerName: string,
    segmentId: bigint,
    lod: number,
  ): Group | null {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordKey, layerName, segmentId.toString(), lod];

    return get(this.meshesGroupsPerSegmentId, keys, null);
  }

  private getMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentId: bigint,
  ): Record<number, Group> | null {
    const keys = [additionalCoordKey, layerName, segmentId.toString()];
    return get(this.meshesGroupsPerSegmentId, keys, null);
  }

  private addMeshToMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentId: bigint,
    lod: number,
    mesh: SceneGroupForMeshes,
  ) {
    const group =
      this.meshesGroupsPerSegmentId[additionalCoordKey][layerName][segmentId.toString()][lod];
    group.add(mesh);
  }

  private removeMeshFromMeshGroups(
    additionalCoordinateKey: string,
    layerName: string,
    segmentId: bigint,
  ) {
    delete this.meshesGroupsPerSegmentId[additionalCoordinateKey][layerName][segmentId.toString()];
  }

  private removeMeshLODFromMeshGroups(
    additionalCoordinateKey: string,
    layerName: string,
    segmentId: bigint,
    lod: number,
  ) {
    delete this.meshesGroupsPerSegmentId[additionalCoordinateKey][layerName][segmentId.toString()][
      lod
    ];
  }

  updateMeshAppearance(
    mesh: MeshSceneNode,
    isHovered: boolean | undefined,
    isActiveUnmappedSegment?: boolean | undefined,
    partitioned?: boolean,
    highlightState?: HighlightState,
  ) {
    // This method has three steps:
    // 1) Check whether (and which of) the provided parameters differ from the actual
    //    appearance.
    // 2) Clear old partial ranges if necessary.
    // 3) Update the appearance.
    const isProofreadingMode =
      Store.getState().uiInformation.activeTool === AnnotationTool.PROOFREAD;

    if (highlightState != null && !isProofreadingMode) {
      // If the proofreading mode is not active and highlightState is not null,
      // we overwrite potential requests to highlight only a range.
      highlightState = "full";
    }

    let wasChanged = false;
    let highlightEntriesToReset: HighlightEntry[] = [];

    if (isHovered != null) {
      if (!isEqual(mesh.hoveredState, highlightState)) {
        if (mesh.hoveredState != null && mesh.hoveredState !== "full") {
          highlightEntriesToReset = highlightEntriesToReset.concat(mesh.hoveredState);
        }
        mesh.hoveredState = highlightState;
        wasChanged = true;
      }
    }

    if (isActiveUnmappedSegment != null) {
      if (!isEqual(mesh.activeState, highlightState)) {
        if (mesh.activeState != null && mesh.activeState !== "full") {
          highlightEntriesToReset = highlightEntriesToReset.concat(mesh.activeState);
        }
        mesh.activeState = highlightState;
        wasChanged = true;
      }
    }

    if (partitioned != null) {
      if (!isEqual(mesh.partitionedState, highlightState)) {
        if (mesh.partitionedState != null && mesh.partitionedState !== "full") {
          highlightEntriesToReset = highlightEntriesToReset.concat(mesh.partitionedState);
        }
        mesh.partitionedState = highlightState;
        wasChanged = true;
      }
    }

    if (!wasChanged) {
      // Nothing to do
      return;
    }

    // mesh.parent.parent contains either
    // - exactly one geometry (if all chunks for the current segment were merged)
    // - one geometry per mesh chunk
    const parent = mesh.parent.parent;
    if (parent == null) {
      // Satisfy TS
      throw new Error("Unexpected null parent");
    }

    // Reset ranges
    if (mesh.material.originalColor != null) {
      for (const rangeToReset of highlightEntriesToReset) {
        setRangeToColor(mesh.geometry, rangeToReset.range, mesh.material.originalColor);
      }
    }

    if (isHovered != null) {
      // Whole-mesh hover (the common case, and the only kind possible for a non-merged
      // mesh) is shown via an emissive glow, tinted to the segment's own color, rather
      // than a color change - the segment's own color/shading stays legible, just
      // brighter, while hovered. This can't represent hovering just part of a merged,
      // multi-segment mesh though (e.g. one specific unmapped segment while
      // proofreading) - emissive is a whole-material property, not a per-range one - so
      // that case is left to the vertex-range recoloring below instead, same as before.
      const isWholeMeshHovered =
        mesh.hoveredState != null && (mesh.hoveredState === "full" || !mesh.isMerged);
      parent.traverse((child) => {
        if (child instanceof Mesh) {
          if (isWholeMeshHovered) {
            const { color, darkness } = getHoverGlowColor(child.material.originalColor);
            child.material.emissive.copy(color);
            child.material.emissiveIntensity =
              HOVER_EMISSIVE_INTENSITY_BASE + darkness * HOVER_EMISSIVE_INTENSITY_DARK_BONUS;
          } else {
            child.material.emissiveIntensity = 0;
          }
        }
      });
    }

    const setMaterialToUniformColor = (material: MeshMaterial, color: Color) => {
      material.vertexColors = false;
      material.color = color;
      material.needsUpdate = true;
    };
    const setMaterialToVertexColors = (material: MeshMaterial) => {
      material.vertexColors = true;
      // White needs to be set so that the vertex colors have precedence.
      // The mesh will have the colors defined in the buffer attribute "color".
      material.color = WHITE;
      material.needsUpdate = true;
    };

    const isUniformColor = mesh.activeState === "full" || !mesh.isMerged;

    if (isUniformColor) {
      const newColor = new Color(...mesh.material.originalColor);

      // Update the material for all meshes that belong to the current
      // segment ID. Only for adhoc meshes, these will contain multiple
      // children. For precomputed meshes, this will only affect one
      // mesh in the scene graph.
      parent.traverse((child) => {
        if (child instanceof Mesh) {
          setMaterialToUniformColor(child.material, newColor);
        }
      });

      return;
    }

    if (mesh.material.color !== WHITE || !mesh.material.vertexColors) {
      setMaterialToVertexColors(mesh.material);
    }

    // The order of highlighting effects by priority is partitioned state > hovered state > active state.
    // Therefore we need to apply them in reverse priority order to ensure correct highlighting.
    if (mesh.activeState && mesh.activeState !== "full") {
      const newColor = ACTIVATED_COLOR_VEC3;
      for (const highlightEntry of mesh.activeState) {
        setRangeToColor(mesh.geometry, highlightEntry.range, highlightEntry.color ?? newColor);
      }
    }
    if (mesh.hoveredState && mesh.hoveredState !== "full") {
      const newColor = HOVERED_COLOR_VEC3;
      for (const highlightEntry of mesh.hoveredState) {
        setRangeToColor(mesh.geometry, highlightEntry.range, highlightEntry.color ?? newColor);
      }
    }
    if (mesh.partitionedState && mesh.partitionedState !== "full") {
      const newColor = ACTIVATED_COLOR_VEC3;
      for (const highlightEntry of mesh.partitionedState) {
        setRangeToColor(mesh.geometry, highlightEntry.range, highlightEntry.color ?? newColor);
      }
    }
    mesh.geometry.attributes.color.needsUpdate = true;
  }

  updateActiveUnmappedSegmentIdHighlighting = (
    activeUnmappedSegmentId: bigint | null | undefined,
  ) => {
    this.meshesLayerLODRootGroup.traverse((_obj) => {
      if (!("geometry" in _obj)) {
        return;
      }
      // The cast is safe because MeshSceneNode adds only optional properties
      const obj = _obj as MeshSceneNode;

      const vertexSegmentMapping = obj.geometry.vertexSegmentMapping;

      let indexRange = null;
      let containsSegmentId = false;
      if (vertexSegmentMapping && activeUnmappedSegmentId) {
        containsSegmentId = vertexSegmentMapping.containsSegmentId(activeUnmappedSegmentId);
        if (containsSegmentId) {
          indexRange = vertexSegmentMapping.getRangeForUnmappedSegmentId(activeUnmappedSegmentId);
        }
      }

      if (activeUnmappedSegmentId != null && containsSegmentId) {
        // Highlight (parts of) the mesh as active
        const highlightEntries =
          indexRange !== null ? [{ range: indexRange, color: undefined }] : null;
        this.updateMeshAppearance(obj, undefined, true, undefined, highlightEntries);
      } else if (obj.activeState) {
        // The mesh has an activeState, but that id is no longer
        // active. Therefore, clear it.
        this.updateMeshAppearance(obj, undefined, false, undefined, null);
      }
    });
  };

  updateMinCutPartitionHighlighting = (minCutPartitions: MinCutPartitions | null) => {
    this.meshesLayerLODRootGroup.traverse((_obj) => {
      if (!("geometry" in _obj)) {
        return;
      }
      // The cast is safe because MeshSceneNode adds only optional properties
      const obj = _obj as MeshSceneNode;

      const vertexSegmentMapping = obj.geometry.vertexSegmentMapping;

      const highlightRanges: HighlightState = [];
      if (vertexSegmentMapping && minCutPartitions) {
        for (const partitionName of MinCutPartitionKeys) {
          const partitionColor = PARTITION_COLORS[partitionName];
          for (const segmentId of minCutPartitions[partitionName]) {
            const containsSegmentId = vertexSegmentMapping.containsSegmentId(segmentId);
            if (containsSegmentId) {
              const indexRange = vertexSegmentMapping.getRangeForUnmappedSegmentId(segmentId);
              if (indexRange) {
                highlightRanges.push({ range: indexRange, color: partitionColor });
              }
            }
          }
        }
      }

      if (highlightRanges.length > 0) {
        // Highlight (parts of) the mesh as active
        this.updateMeshAppearance(obj, undefined, undefined, true, highlightRanges);
      } else if (obj.partitionedState) {
        // The mesh has an activeState, but that id is no longer
        // active. Therefore, clear it.
        this.updateMeshAppearance(obj, undefined, undefined, false, null);
      }
    });
  };

  throttledUpdateActiveUnmappedSegmentIdHighlighting = throttle(
    this.updateActiveUnmappedSegmentIdHighlighting,
    150,
  );

  throttledUpdateMinCutPartitionHighlighting = throttle(
    this.updateMinCutPartitionHighlighting,
    150,
  );

  destroy(): void {
    this.throttledUpdateActiveUnmappedSegmentIdHighlighting.cancel();
    this.throttledUpdateMinCutPartitionHighlighting.cancel();
    // Dispose all mesh groups (across all additional coordinates) so that
    // their geometries and materials are freed on the GPU.
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentId)) {
      for (const recordsOfSegments of Object.values(recordsOfLayers)) {
        for (const recordsOfLODs of Object.values(recordsOfSegments)) {
          for (const meshGroup of Object.values(recordsOfLODs)) {
            this.disposeMeshGroup(meshGroup);
          }
        }
      }
    }
    this.meshesGroupsPerSegmentId = {};
  }
}
