import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import _ from "lodash";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FrontSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3 as ThreeVector3,
} from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import TWEEN from "tween.js";
import type { AdditionalCoordinate } from "types/api_types";
import type { Vector2, Vector3 } from "viewer/constants";
import CustomLOD from "viewer/controller/custom_lod";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  getActiveSegmentationTracing,
  getSegmentColorAsHSLA,
} from "viewer/model/accessors/volumetracing_accessor";
import Store, { type MinCutPartitions } from "viewer/store";

import { computeBvhAsync } from "libs/compute_bvh_async";
import Constants from "viewer/constants";
import { NO_LOD_MESH_INDEX } from "viewer/model/sagas/meshes/common_mesh_saga";
import type { BufferGeometryWithInfo } from "./mesh_helpers";

// Add the raycast function. Assumes the BVH is available on
// the `boundsTree` variable
Mesh.prototype.raycast = acceleratedRaycast;

const hslToSRGB = (hsl: Vector3) => new Color().setHSL(...hsl).convertSRGBToLinear();

const WHITE = new Color(1, 1, 1);
const ACTIVATED_COLOR = hslToSRGB([0.7, 0.9, 0.75]);
const HOVERED_COLOR = hslToSRGB([0.65, 0.9, 0.75]);
const PARTITION_COLORS = {
  1: [1, 0, 0] as Vector3,
  2: [0, 1, 0] as Vector3,
};
const ACTIVATED_COLOR_VEC3 = ACTIVATED_COLOR.toArray() as Vector3;
const HOVERED_COLOR_VEC3 = HOVERED_COLOR.toArray() as Vector3;

type MeshMaterial = MeshLambertMaterial & { originalColor: Vector3 };
type HighlightEntry = { range: Vector2; color?: Vector3 };
type HighlightState = HighlightEntry[] | "full" | null;
export type MeshSceneNode = Mesh<BufferGeometryWithInfo, MeshMaterial> & {
  hoveredState?: HighlightState;
  activeState?: HighlightState;
  partitionedState?: HighlightState;
  parent: SceneGroupForMeshes;
  isMerged: boolean;
};
export type SceneGroupForMeshes = Group & { segmentId: number; children: MeshSceneNode[] };

const setRangeToColor = (
  geometry: BufferGeometryWithInfo,
  indexRange: Vector2 | null,
  color: Vector3,
) => {
  if (indexRange == null) {
    indexRange = [0, geometry.attributes.color.count];
  }
  for (let index = indexRange[0]; index < indexRange[1]; index++) {
    (geometry.attributes.color as BufferAttribute).set(color, 3 * index);
  }
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
      string, // layerName
      Record<
        number, // segmentId
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
    id: number,
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
    segmentId: number,
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
    segmentId: number,
    layerName: string,
    geometry: BufferGeometryWithInfo,
    opacity: number | undefined,
    isMerged: boolean,
  ): MeshSceneNode {
    const color = this.getColorObjectForSegment(segmentId, layerName);
    const meshMaterial = new MeshLambertMaterial({
      vertexColors: true,
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
    segmentId: number,
    scale: Vector3 | null = null,
    lod: number,
    layerName: string,
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
    opacity: number | undefined,
    isMerged: boolean,
  ): void {
    const additionalCoordinatesString = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordinatesString, layerName, segmentId, lod];
    const isNewlyAddedMesh = _.get(this.meshesGroupsPerSegmentId, keys) == null;
    const targetGroup: SceneGroupForMeshes = _.get(
      this.meshesGroupsPerSegmentId,
      keys,
      new Group(),
    );
    _.setWith(this.meshesGroupsPerSegmentId, keys, targetGroup, Object);
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

    const segmentationTracing = getActiveSegmentationTracing(Store.getState());
    if (segmentationTracing != null) {
      // addMeshFromGeometry is often called multiple times for different sets of geometries.
      // Therefore, used a throttled variant of the highlightActiveUnmappedSegmentId method.
      this.throttledHighlightActiveUnmappedSegmentId(segmentationTracing.activeUnmappedSegmentId);
    }
  }

  removeMeshById(segmentId: number, layerName: string, options?: { lod: number }): void {
    const additionalCoordinates = Store.getState().flycam.additionalCoordinates;
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

    _.forEach(meshGroups, (meshGroup, lodStr) => {
      const currentLod = Number.parseInt(lodStr);

      if (options && currentLod !== options.lod) {
        // If options.lod is provided, only remove that LOD.
        return;
      }

      if (currentLod !== NO_LOD_MESH_INDEX) {
        lodMeshGroupForLayer.removeLODMesh(meshGroup, currentLod);
      } else {
        lodMeshGroupForLayer.removeNoLODSupportedMesh(meshGroup);
      }

      this.removeMeshLODFromMeshGroups(additionalCoordKey, layerName, segmentId, currentLod);
    });
    if (options == null) {
      // If options.lod is provided, the parent group should not be removed
      this.removeMeshFromMeshGroups(additionalCoordKey, layerName, segmentId);
    }
  }

  getMeshGeometryInBestLOD(
    segmentId: number,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): Group | null {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const meshGroups = this.getMeshGroups(additionalCoordKey, layerName, segmentId);

    if (meshGroups == null) return null;

    const bestLod = Math.min(...Object.keys(meshGroups).map((lodVal) => Number.parseInt(lodVal)));

    return this.getMeshGroupsByLOD(additionalCoordinates, layerName, segmentId, bestLod);
  }

  setMeshVisibility(
    id: number,
    visibility: boolean,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): void {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    _.forEach(this.getMeshGroups(additionalCoordKey, layerName, id), (meshGroup) => {
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
    segmentId: number,
    functionToApply: (child: MeshSceneNode) => void,
  ) => {
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentId)) {
      const meshDataForOneSegment = recordsOfLayers[layerName][segmentId];
      if (meshDataForOneSegment != null) {
        for (const lodGroup of Object.values(meshDataForOneSegment)) {
          for (const meshGroup of lodGroup.children) {
            meshGroup.children.forEach(functionToApply);
          }
        }
      }
    }
  };

  setMeshColor(id: number, layerName: string, opacity?: number): void {
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

  setMeshOpacity(id: number, layerName: string, opacity: number): void {
    // If in nd-dataset, set the opacity for all additional coordinates
    this.applyOnMeshGroupChildren(layerName, id, (child: MeshSceneNode) => {
      child.material.opacity = opacity;
    });
  }

  getColorObjectForSegment(segmentId: number, layerName: string) {
    const [hue, saturation, light] = getSegmentColorAsHSLA(Store.getState(), segmentId, layerName);
    const color = new Color().setHSL(hue, saturation, light);
    color.convertSRGBToLinear();

    return color;
  }

  addLights(): void {
    const settings = {
      ambientIntensity: 0.41,
      dirLight1Intensity: 0.54,
      dirLight2Intensity: 0.29,
      dirLight3Intensity: 0.29,
      dirLight4Intensity: 0.17,
      dirLight5Intensity: 1.03,
      dirLight6Intensity: 0.29,
      dirLight7Intensity: 0.17,
      dirLight8Intensity: 0.54,
    };

    // Note that the PlaneView also attaches a directional light directly to the TD camera,
    // so that the light moves along the cam.
    const ambientLight = new AmbientLight("white", settings.ambientIntensity);
    this.lightsGroup.add(ambientLight);

    const lightPositions: Vector3[] = [
      [1, 1, 1],
      [-1, 1, 1],
      [1, -1, 1],
      [-1, -1, 1],
      [1, 1, -1],
      [-1, 1, -1],
      [1, -1, -1],
      [-1, -1, -1],
    ];

    const directionalLights: DirectionalLight[] = [];

    lightPositions.forEach((pos, index) => {
      const light = new DirectionalLight(
        WHITE,
        // @ts-ignore
        settings[`dirLight${index + 1}Intensity`] || 1,
      );
      light.position.set(...pos).normalize();
      directionalLights.push(light);
      this.lightsGroup.add(light);
    });
  }

  private getMeshGroupsByLOD(
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
    layerName: string,
    segmentId: number,
    lod: number,
  ): Group | null {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordKey, layerName, segmentId, lod];

    return _.get(this.meshesGroupsPerSegmentId, keys, null);
  }

  private getMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentId: number,
  ): Record<number, Group> | null {
    const keys = [additionalCoordKey, layerName, segmentId];
    return _.get(this.meshesGroupsPerSegmentId, keys, null);
  }

  private addMeshToMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentId: number,
    lod: number,
    mesh: SceneGroupForMeshes,
  ) {
    const group = this.meshesGroupsPerSegmentId[additionalCoordKey][layerName][segmentId][lod];
    group.add(mesh);
  }

  private removeMeshFromMeshGroups(
    additionalCoordinateKey: string,
    layerName: string,
    segmentId: number,
  ) {
    delete this.meshesGroupsPerSegmentId[additionalCoordinateKey][layerName][segmentId];
  }

  private removeMeshLODFromMeshGroups(
    additionalCoordinateKey: string,
    layerName: string,
    segmentId: number,
    lod: number,
  ) {
    delete this.meshesGroupsPerSegmentId[additionalCoordinateKey][layerName][segmentId][lod];
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
      if (!_.isEqual(mesh.hoveredState, highlightState)) {
        if (mesh.hoveredState != null && mesh.hoveredState !== "full") {
          highlightEntriesToReset = highlightEntriesToReset.concat(mesh.hoveredState);
        }
        mesh.hoveredState = highlightState;
        wasChanged = true;
      }
    }

    if (isActiveUnmappedSegment != null) {
      if (!_.isEqual(mesh.activeState, highlightState)) {
        if (mesh.activeState != null && mesh.activeState !== "full") {
          highlightEntriesToReset = highlightEntriesToReset.concat(mesh.activeState);
        }
        mesh.activeState = highlightState;
        wasChanged = true;
      }
    }

    if (partitioned != null) {
      if (!_.isEqual(mesh.partitionedState, highlightState)) {
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

    const isUniformColor = (mesh.activeState || mesh.hoveredState) === "full" || !mesh.isMerged;

    if (isUniformColor) {
      let newColor = mesh.hoveredState ? HOVERED_COLOR : new Color(...mesh.material.originalColor);

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

    if (mesh.activeState && mesh.activeState !== "full") {
      const newColor = ACTIVATED_COLOR_VEC3;
      for (const highlightEntry of mesh.activeState) {
        setRangeToColor(mesh.geometry, highlightEntry.range, highlightEntry.color ?? newColor);
      }
    }
    if (mesh.partitionedState && mesh.partitionedState !== "full") {
      const newColor = ACTIVATED_COLOR_VEC3;
      for (const highlightEntry of mesh.partitionedState) {
        setRangeToColor(mesh.geometry, highlightEntry.range, highlightEntry.color ?? newColor);
      }
    }
    // Setting the hovered part needs to happen after setting the active & partition part,
    // so that there is still a hover effect for an active super voxel.
    if (mesh.hoveredState && mesh.hoveredState !== "full") {
      const newColor = HOVERED_COLOR_VEC3;
      for (const highlightEntry of mesh.hoveredState) {
        setRangeToColor(mesh.geometry, highlightEntry.range, highlightEntry.color ?? newColor);
      }
    }
    mesh.geometry.attributes.color.needsUpdate = true;
  }

  highlightActiveUnmappedSegmentId = (activeUnmappedSegmentId: number | null | undefined) => {
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
        for (const partitionNumber of [1, 2]) {
          const partition = partitionNumber as 1 | 2;
          const partitionColor = PARTITION_COLORS[partition];
          for (const segmentId of minCutPartitions[partition]) {
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

  throttledHighlightActiveUnmappedSegmentId = _.throttle(
    this.highlightActiveUnmappedSegmentId,
    150,
  );
}
