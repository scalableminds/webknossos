import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import { computeBvhAsync } from "libs/compute_bvh_async";
import { createTween } from "libs/tween_group";
import { clamp } from "libs/utils";
import forEach from "lodash-es/forEach";
import get from "lodash-es/get";
import isEqual from "lodash-es/isEqual";
import setWith from "lodash-es/setWith";
import throttle from "lodash-es/throttle";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FrontSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  Vector3 as ThreeVector3,
} from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
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
// Only used when part of a merged mesh is hovered (proofreading). The hover glow
// applies to the whole mesh, so that part is recolored instead.
const HOVERED_COLOR_VEC3 = hslToSRGB([0.65, 0.9, 0.75]).toArray() as Vector3;
// A hovered mesh glows via its emissive color, which is tinted with the segment color.
// A dark or dull tint barely shows on a dark surface, so getHoverGlowColor lightens and
// saturates the tint, and the intensity is raised, the darker/duller the color is.
// Light, saturated colors stay close to unchanged.
const HOVER_GLOW_TARGET_LIGHTNESS = 0.65;
const HOVER_GLOW_TARGET_SATURATION = 0.8;
const HOVER_GLOW_MAX_LIGHTNESS_BLEND = 0.7;
const HOVER_GLOW_MAX_SATURATION_BLEND = 0.4;
// BASE applies to all colors and mainly sets how noticeable the glow is for light
// colors. DARK_BONUS is scaled by how dark the color is.
const HOVER_EMISSIVE_INTENSITY_BASE = 0.15;
const HOVER_EMISSIVE_INTENSITY_DARK_BONUS = 0.35;

const getHoverGlowColor = (originalColor: Vector3): { color: Color; darkness: number } => {
  // originalColor is in linear space. Convert it back to sRGB so that the HSL values
  // match the segment's hex color.
  const srgbColor = new Color(...originalColor).convertLinearToSRGB();
  const hsl = { h: 0, s: 0, l: 0 };
  srgbColor.getHSL(hsl);

  // 0 if the color is at least as light/saturated as the target, up to 1 for black/gray.
  const darkness = clamp(0, 1 - hsl.l / HOVER_GLOW_TARGET_LIGHTNESS, 1);
  const dullness = clamp(0, 1 - hsl.s / HOVER_GLOW_TARGET_SATURATION, 1);

  const boostedLightness =
    hsl.l + (HOVER_GLOW_TARGET_LIGHTNESS - hsl.l) * darkness * HOVER_GLOW_MAX_LIGHTNESS_BLEND;
  const boostedSaturation =
    hsl.s + (HOVER_GLOW_TARGET_SATURATION - hsl.s) * dullness * HOVER_GLOW_MAX_SATURATION_BLEND;

  const color = new Color().setHSL(hsl.h, boostedSaturation, boostedLightness);
  color.convertSRGBToLinear();
  return { color, darkness };
};

const setHoverGlow = (material: MeshMaterial, isGlowing: boolean) => {
  if (!isGlowing) {
    material.emissiveIntensity = 0;
    return;
  }
  const { color, darkness } = getHoverGlowColor(material.originalColor);
  material.emissive.copy(color);
  material.emissiveIntensity =
    HOVER_EMISSIVE_INTENSITY_BASE + darkness * HOVER_EMISSIVE_INTENSITY_DARK_BONUS;
};

// Dark colors reflect so little light that the colorless highlights dominate and they
// look almost black. So, colors with a lightness (HSL) below MIN_MESH_LIGHTNESS are
// moved DARK_LIGHTNESS_LIFT of the way towards it, e.g. #800000 (lightness 0.25) is
// rendered with a lightness of 0.35. Lighter colors are left untouched.
const MIN_MESH_LIGHTNESS = 0.45;
const DARK_LIGHTNESS_LIFT = 0.5;

const liftDarkLightness = (lightness: number) =>
  lightness < MIN_MESH_LIGHTNESS
    ? lightness + (MIN_MESH_LIGHTNESS - lightness) * DARK_LIGHTNESS_LIFT
    : lightness;

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

  // The segment whose meshes are highlighted because it is hovered (in a 2D viewport,
  // the segments list or the 3D viewport). Only the key is stored (instead of the meshes)
  // so that removed meshes are neither updated nor kept alive.
  private hoveredSegmentToHighlight: {
    segmentId: bigint;
    layerName: string;
    additionalCoordKey: string;
  } | null = null;

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
      // A soft highlight makes curved surfaces (e.g. dendrites) read as 3D. Lower
      // roughness looks like plastic, higher roughness makes the highlight barely visible.
      roughness: 0.4,
      metalness: 0.05,
      // Sheen adds a white glint at grazing angles, e.g. along silhouettes. Kept low and
      // narrow, since more sheen washes out the segment color.
      sheen: 0.2,
      sheenRoughness: 0.25,
      sheenColor: WHITE,
      // A thin clearcoat adds a second, sharper highlight ("wet tissue" look). It's
      // almost colorless and concentrated, so it doesn't wash out the segment color.
      clearcoat: 0.05,
      clearcoatRoughness: 0.1,
    }) as MeshMaterial;
    meshMaterial.side = FrontSide;
    meshMaterial.transparent = true;
    // getColorObjectForSegment already returns the color in linear space.
    const colorArray = color.toArray() as Vector3;
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

    const tweenAnimation = createTween({
      opacity: 0,
    });
    tweenAnimation
      .to(
        {
          opacity: opacity ?? Constants.DEFAULT_MESH_OPACITY,
        },
        100,
      )
      .onUpdate((tweenState: { opacity: number }) => {
        meshMaterial.opacity = tweenState.opacity;
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

    // Mesh chunks can stream in while their segment is hovered. Highlight them, too.
    const hoveredSegment = this.hoveredSegmentToHighlight;
    if (
      hoveredSegment != null &&
      hoveredSegment.segmentId === segmentId &&
      hoveredSegment.layerName === layerName &&
      hoveredSegment.additionalCoordKey === additionalCoordinatesString
    ) {
      this.updateMeshAppearance(meshChunk, true, undefined, undefined, "full");
    }

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
      // Re-tint the glow of a hovered mesh with the new color.
      if (child.material.emissiveIntensity > 0) {
        setHoverGlow(child.material, true);
      }
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
    const color = new Color().setHSL(hue, saturation, liftDarkLightness(light));
    color.convertSRGBToLinear();

    return color;
  }

  addLights(): void {
    // The main lights are attached to the TD camera (see PlaneView). These world-space
    // lights only keep meshes from going completely black. They are few and faint on
    // purpose: many similar lights from all directions cancel out the shading.
    // Unlike an ambient light, the hemisphere light has a soft top-to-bottom gradient,
    // so it lifts the shadows without making the meshes look flat. "Up" is -z, which
    // matches the up vector of the default TD camera.
    const hemisphereLight = new HemisphereLight("white", 0x808080, 0.25);
    hemisphereLight.position.set(0, 0, -1);
    this.lightsGroup.add(hemisphereLight);

    // Faint, cool-toned light from behind so that overlapping branches keep a visible edge.
    const rimLight = new DirectionalLight(0xcfe0ff, 0.5);
    rimLight.position.set(-1, 0.5, -1).normalize();
    this.lightsGroup.add(rimLight);

    // Faint, warm-toned light from below so that undersides never go completely black.
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
      // The glow applies to the whole material. If only part of a merged mesh is
      // hovered (proofreading), that part is recolored below instead.
      const isWholeMeshHovered =
        mesh.hoveredState != null && (mesh.hoveredState === "full" || !mesh.isMerged);
      parent.traverse((child) => {
        if (child instanceof Mesh) {
          setHoverGlow(child.material, isWholeMeshHovered);
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

  updateHoveredSegmentIdHighlighting = (
    hoveredSegmentId: bigint | null,
    layerName: string | null,
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
  ) => {
    const previous = this.hoveredSegmentToHighlight;
    if (previous != null) {
      // Meshes that were removed in the meantime are no longer part of meshesGroupsPerSegmentId
      // and are therefore skipped.
      forEach(
        this.getMeshGroups(previous.additionalCoordKey, previous.layerName, previous.segmentId),
        (lodGroup) => {
          lodGroup.traverse((obj) => {
            if (obj instanceof Mesh && (obj as MeshSceneNode).hoveredState != null) {
              this.updateMeshAppearance(obj as MeshSceneNode, false, undefined, undefined, null);
            }
          });
        },
      );
    }
    this.hoveredSegmentToHighlight = null;

    if (!hoveredSegmentId || layerName == null) {
      return;
    }
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    this.hoveredSegmentToHighlight = { segmentId: hoveredSegmentId, layerName, additionalCoordKey };
    forEach(this.getMeshGroups(additionalCoordKey, layerName, hoveredSegmentId), (lodGroup) => {
      // Highlighting one mesh with "full" recolors all meshes of its LOD group.
      const mesh = lodGroup.children[0]?.children[0] as MeshSceneNode | undefined;
      if (mesh != null) {
        this.updateMeshAppearance(mesh, true, undefined, undefined, "full");
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
