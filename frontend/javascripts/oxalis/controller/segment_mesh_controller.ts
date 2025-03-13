import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import _ from "lodash";
import type { Vector2, Vector3 } from "oxalis/constants";
import CustomLOD from "oxalis/controller/custom_lod";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";
import {
  getActiveSegmentationTracing,
  getSegmentColorAsHSLA,
} from "oxalis/model/accessors/volumetracing_accessor";
import { NO_LOD_MESH_INDEX } from "oxalis/model/sagas/mesh_saga";
import Store from "oxalis/store";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import type { AdditionalCoordinate } from "types/api_flow_types";
import { MeshBVHHelper, acceleratedRaycast } from "three-mesh-bvh";

import GUI from "lil-gui";
import { computeBvhAsync } from "libs/compute_bvh_async";

// Add the raycast function. Assumes the BVH is available on
// the `boundsTree` variable
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const hslToSRGB = (hsl: Vector3) => new THREE.Color().setHSL(...hsl).convertSRGBToLinear();

const WHITE = new THREE.Color(1, 1, 1);
const ACTIVATED_COLOR = hslToSRGB([0.7, 0.9, 0.75]);
const HOVERED_COLOR = hslToSRGB([0.65, 0.9, 0.75]);
const ACTIVATED_COLOR_VEC3 = ACTIVATED_COLOR.toArray() as Vector3;
const HOVERED_COLOR_VEC3 = HOVERED_COLOR.toArray() as Vector3;

type MeshMaterial = THREE.MeshLambertMaterial & { originalColor: Vector3 };
type HighlightState = Vector2 | "full" | null;
export type MeshSceneNode = THREE.Mesh<BufferGeometryWithInfo, MeshMaterial> & {
  hoveredState?: HighlightState;
  activeState?: HighlightState;
  parent: SceneGroupForMeshes;
  isMerged: boolean;
};
export type SceneGroupForMeshes = THREE.Group & { segmentId: number; children: MeshSceneNode[] };

export class PositionToSegmentId {
  cumulativeStartPosition: number[];
  unmappedSegmentIds: number[];
  constructor(sortedBufferGeometries: UnmergedBufferGeometryWithInfo[]) {
    let cumsum = 0;
    this.cumulativeStartPosition = [];
    this.unmappedSegmentIds = [];

    for (const bufferGeometry of sortedBufferGeometries) {
      const isNewSegmentId =
        this.unmappedSegmentIds.length === 0 ||
        bufferGeometry.unmappedSegmentId !== this.unmappedSegmentIds.at(-1);

      if (isNewSegmentId) {
        this.unmappedSegmentIds.push(bufferGeometry.unmappedSegmentId);
        this.cumulativeStartPosition.push(cumsum);
      }
      cumsum += bufferGeometry.attributes.position.count;
    }
    this.cumulativeStartPosition.push(cumsum);
  }

  getUnmappedSegmentIdForPosition(position: number) {
    const index = _.sortedIndex(this.cumulativeStartPosition, position) - 1;
    return this.unmappedSegmentIds[index];
  }

  getRangeForPosition(position: number): [number, number] {
    const index = _.sortedIndex(this.cumulativeStartPosition, position) - 1;
    return [this.cumulativeStartPosition[index], this.cumulativeStartPosition[index + 1]];
  }

  getRangeForUnmappedSegmentId(segmentId: number): [number, number] | null {
    const index = _.sortedIndexOf(this.unmappedSegmentIds, segmentId);
    if (index === -1) {
      return null;
    }
    return [this.cumulativeStartPosition[index], this.cumulativeStartPosition[index + 1]];
  }

  containsSegmentId(segmentId: number): boolean {
    return _.sortedIndexOf(this.unmappedSegmentIds, segmentId) !== -1;
  }
}

const setRangeToColor = (
  geometry: BufferGeometryWithInfo,
  indexRange: Vector2 | null,
  color: Vector3,
) => {
  if (indexRange == null) {
    indexRange = [0, geometry.attributes.color.count];
  }
  for (let index = indexRange[0]; index < indexRange[1]; index++) {
    geometry.attributes.color.set(color, 3 * index);
  }
};

export type BufferGeometryWithInfo = THREE.BufferGeometry & {
  positionToSegmentId?: PositionToSegmentId;
};

export type UnmergedBufferGeometryWithInfo = THREE.BufferGeometry & {
  unmappedSegmentId: number;
  positionToSegmentId?: PositionToSegmentId;
};

type GroupForLOD = THREE.Group & {
  children: SceneGroupForMeshes[];
  forEach: (callback: (el: SceneGroupForMeshes) => void) => void;
};

export default class SegmentMeshController {
  // meshesLODRootGroup holds lights and one group per segment id.
  // Each group can hold multiple meshes.
  meshesLODRootGroup: CustomLOD;

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
    this.meshesLODRootGroup = new CustomLOD();
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
    additionalCoordinates?: AdditionalCoordinate[] | undefined | null,
  ): Promise<void> {
    // Currently, this function is only used by ad hoc meshing.
    if (vertices.length === 0) return;
    let bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

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
      false,
    );
  }

  constructMesh(
    segmentId: number,
    layerName: string,
    geometry: BufferGeometryWithInfo,
    isMerged: boolean,
  ): MeshSceneNode {
    const color = this.getColorObjectForSegment(segmentId, layerName);
    const meshMaterial = new THREE.MeshLambertMaterial({
      // color,
      vertexColors: true,
    }) as MeshMaterial;
    meshMaterial.side = THREE.FrontSide;
    // todop: would it help to set it to false once the opacity is 1 ? hopefully not...
    meshMaterial.transparent = true;
    const colorArray = color.convertSRGBToLinear().toArray() as Vector3;
    meshMaterial.originalColor = colorArray;
    // todop: necessary?
    // meshMaterial.blending = THREE.NormalBlending;

    // const colorArray: readonly [number, number, number] = HOVERED_COLOR_VEC3;
    // todop: can we avoid constructing this when not necessary?
    const colorBuffer = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      colorBuffer.set(colorArray, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colorBuffer, 3));

    // mesh.parent is still null at this moment, but when the mesh is
    // added to the group later, parent will be set. We'll ignore
    // this detail for now via the casting.
    const mesh = new THREE.Mesh(geometry, meshMaterial) as any as MeshSceneNode;
    mesh.isMerged = isMerged;

    // todop: test whether this changes sth? also test perf
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const tweenAnimation = new TWEEN.Tween({
      opacity: 0,
    });
    tweenAnimation
      .to(
        {
          opacity: 1,
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
    isMerged: boolean,
  ): void {
    const additionalCoordinatesString = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordinatesString, layerName, segmentId, lod];
    const isNewlyAddedMesh =
      this.meshesGroupsPerSegmentId[additionalCoordinatesString]?.[layerName]?.[segmentId]?.[lod] ==
      null;
    const targetGroup: SceneGroupForMeshes = _.get(
      this.meshesGroupsPerSegmentId,
      keys,
      new THREE.Group(),
    );
    _.set(this.meshesGroupsPerSegmentId, keys, targetGroup);
    if (isNewlyAddedMesh) {
      if (lod === NO_LOD_MESH_INDEX) {
        this.meshesLODRootGroup.addNoLODSupportedMesh(targetGroup);
      } else {
        this.meshesLODRootGroup.addLODMesh(targetGroup, lod);
      }
      targetGroup.segmentId = segmentId;
      if (scale != null) {
        targetGroup.scale.copy(new THREE.Vector3(...scale));
      }
    }
    console.time("constructMesh");
    const meshChunk = this.constructMesh(segmentId, layerName, geometry, isMerged);
    console.timeEnd("constructMesh");

    const group = new THREE.Group() as SceneGroupForMeshes;

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

  removeMeshById(segmentId: number, layerName: string): void {
    const additionalCoordinates = Store.getState().flycam.additionalCoordinates;
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const meshGroups = this.getMeshGroups(additionalCoordKey, layerName, segmentId);
    if (meshGroups == null) {
      return;
    }
    _.forEach(meshGroups, (meshGroup, lod) => {
      const lodNumber = Number.parseInt(lod);
      if (lodNumber !== NO_LOD_MESH_INDEX) {
        this.meshesLODRootGroup.removeLODMesh(meshGroup, lodNumber);
      } else {
        this.meshesLODRootGroup.removeNoLODSupportedMesh(meshGroup);
      }
    });
    this.removeMeshFromMeshGroups(additionalCoordKey, layerName, segmentId);
  }

  getMeshGeometryInBestLOD(
    segmentId: number,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): THREE.Group | null {
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

  setMeshColor(id: number, layerName: string): void {
    const color = this.getColorObjectForSegment(id, layerName);
    const colorArray = color.toArray() as Vector3;
    // If in nd-dataset, set the color for all additional coordinates
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentId)) {
      const meshDataForOneSegment = recordsOfLayers[layerName][id];
      if (meshDataForOneSegment != null) {
        for (const lodGroup of Object.values(meshDataForOneSegment)) {
          for (const meshGroup of lodGroup.children) {
            meshGroup.children.forEach((child: MeshSceneNode) => {
              child.material.originalColor = colorArray;
              if (child.material.vertexColors) {
                setRangeToColor(child.geometry, null, colorArray);
                child.geometry.attributes.color.needsUpdate = true;
              } else {
                child.material.color = color;
              }
            });
          }
        }
      }
    }
  }

  getColorObjectForSegment(segmentId: number, layerName: string) {
    const [hue, saturation, light] = getSegmentColorAsHSLA(Store.getState(), segmentId, layerName);
    const color = new THREE.Color().setHSL(hue, saturation, light);
    color.convertSRGBToLinear();
    return color;
  }

  getGui() {
    if (!window.gui) {
      window.gui = new GUI();
    }
    return window.gui;
  }

  addLights(): void {
    // const ambientLight2 = new THREE.AmbientLight(0x888888, 1.0 * Math.PI);
    // // const directionalLight = new THREE.DirectionalLight(0x888888, 1.0 * Math.PI);
    // this.meshesLODRootGroup.add(ambientLight2);
    // // this.meshesLODRootGroup.add(directionalLight);

    // return;

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

    const gui = this.getGui();
    gui.add(settings, "ambientIntensity", 0, 10);
    gui.add(settings, "dirLight1Intensity", 0, 10);
    gui.add(settings, "dirLight2Intensity", 0, 10);
    gui.add(settings, "dirLight3Intensity", 0, 10);
    gui.add(settings, "dirLight4Intensity", 0, 10);
    gui.add(settings, "dirLight5Intensity", 0, 10);
    gui.add(settings, "dirLight6Intensity", 0, 10);
    gui.add(settings, "dirLight7Intensity", 0, 10);
    gui.add(settings, "dirLight8Intensity", 0, 10);

    // Note that the PlaneView also attaches a directional light directly to the TD camera,
    // so that the light moves along the cam.
    const ambientLight = new THREE.AmbientLight("white", settings.ambientIntensity);
    this.meshesLODRootGroup.add(ambientLight);

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

    const directionalLights: THREE.DirectionalLight[] = [];

    lightPositions.forEach((pos, index) => {
      const light = new THREE.DirectionalLight(
        WHITE,
        // @ts-ignore
        settings[`dirLight${index + 1}Intensity`] || 1,
      );
      light.position.set(...pos).normalize();
      directionalLights.push(light);
      this.meshesLODRootGroup.add(light);
    });

    gui.onChange(() => {
      ambientLight.intensity = settings.ambientIntensity;
      directionalLights.forEach((light, index) => {
        // @ts-ignore
        light.intensity = settings[`dirLight${index + 1}Intensity`] || 1;
      });
      app.vent.emit("rerender");
    });
  }

  private getMeshGroupsByLOD(
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
    layerName: string,
    segmentId: number,
    lod: number,
  ): THREE.Group | null {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordKey, layerName, segmentId, lod];
    return _.get(this.meshesGroupsPerSegmentId, keys, null);
  }

  private getMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentId: number,
  ): Record<number, THREE.Group> | null {
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

  updateMeshAppearance(
    mesh: MeshSceneNode,
    isHovered: boolean | undefined,
    isActiveUnmappedSegment?: boolean | undefined,
    highlightState?: HighlightState,
  ) {
    // This method has three steps:
    // 1) Check whether (and which of) the provided parameters differ from the actual
    //    appearance.
    // 2) Clear old partial ranges if necessary.
    // 3) Update the appearance.
    const isProofreadingMode = Store.getState().uiInformation.activeTool === "PROOFREAD";

    if (highlightState != null && !isProofreadingMode) {
      // If the proofreading mode is not active and highlightState is not null,
      // we overwrite potential requests to highlight only a range.
      highlightState = "full";
    }

    let wasChanged = false;
    const rangesToReset: Vector2[] = [];
    if (isHovered != null) {
      if (!_.isEqual(mesh.hoveredState, highlightState)) {
        if (mesh.hoveredState != null && mesh.hoveredState !== "full") {
          rangesToReset.push(mesh.hoveredState);
        }
        mesh.hoveredState = highlightState;
        wasChanged = true;
      }
    }
    if (isActiveUnmappedSegment != null) {
      if (!_.isEqual(mesh.activeState, highlightState)) {
        if (mesh.activeState != null && mesh.activeState !== "full") {
          rangesToReset.push(mesh.activeState);
        }
        mesh.activeState = highlightState;
        wasChanged = true;
      }
    }
    if (!wasChanged) {
      // Nothing to do
      return;
    }

    // todop: restore?
    // const targetOpacity = mesh.hoveredState ? 0.8 : 1.0;

    // mesh.parent.parent contains exactly one geometry (merged from all chunks
    // for the current segment).
    const parent = mesh.parent.parent;
    if (parent == null) {
      // Satisfy TS
      throw new Error("Unexpected null parent");
    }
    // We update the opacity for all meshes that belong to the current
    // segment ID (in contrast to the color) so that the user can
    // see which other super voxels belong to the segment id of the
    // hovered super-voxel.
    // parent.traverse((child) => {
    //   if (child instanceof THREE.Mesh) {
    //     child.material.opacity = targetOpacity;
    //   }
    // });

    // Reset ranges
    for (const rangeToReset of rangesToReset) {
      const indexRange = rangeToReset;

      if (mesh.material.originalColor != null) {
        setRangeToColor(mesh.geometry, indexRange, mesh.material.originalColor);
      }
    }

    const setMaterialToUniformColor = (material: MeshMaterial, color: THREE.Color) => {
      material.vertexColors = false;
      material.color = color;
      material.needsUpdate = true;
    };

    const setColor = () => {
      const isUniformColor = (mesh.activeState || mesh.hoveredState) === "full" || !mesh.isMerged;

      if (isUniformColor) {
        let newColor = mesh.hoveredState
          ? HOVERED_COLOR
          : new THREE.Color(...mesh.material.originalColor);

        // Update the material for all meshes that belong to the current
        // segment ID. Only for adhoc meshes, these will contain multiple
        // children. For precomputed meshes, this will only affect one
        // mesh in the scene graph.
        parent.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            setMaterialToUniformColor(child.material, newColor);
          }
        });

        return;
      }

      if (mesh.material.color !== WHITE || !mesh.material.vertexColors) {
        mesh.material.color = WHITE;
        mesh.material.needsUpdate = true;
        mesh.material.vertexColors = true;
      }

      if (mesh.activeState && mesh.activeState !== "full") {
        const newColor = ACTIVATED_COLOR_VEC3;
        setRangeToColor(mesh.geometry, mesh.activeState, newColor);
      }
      // Setting the hovered part needs to happen after setting the active part,
      // so that there is still a hover effect for an active super voxel.
      if (mesh.hoveredState && mesh.hoveredState !== "full") {
        const newColor = HOVERED_COLOR_VEC3;
        setRangeToColor(mesh.geometry, mesh.hoveredState, newColor);
      }
      mesh.geometry.attributes.color.needsUpdate = true;
    };

    setColor();
  }

  highlightActiveUnmappedSegmentId = (activeUnmappedSegmentId: number | null | undefined) => {
    const { meshesLODRootGroup } = this;
    meshesLODRootGroup.traverse((_obj) => {
      if (!("geometry" in _obj)) {
        return;
      }
      // The cast is safe because MeshSceneNode adds only optional properties
      const obj = _obj as MeshSceneNode;

      const positionToSegmentId = obj.geometry.positionToSegmentId;

      let indexRange = null;
      let containsSegmentId = false;
      if (positionToSegmentId && activeUnmappedSegmentId) {
        containsSegmentId = positionToSegmentId.containsSegmentId(activeUnmappedSegmentId);
        if (containsSegmentId) {
          indexRange = positionToSegmentId.getRangeForUnmappedSegmentId(activeUnmappedSegmentId);
        }
      }

      if (activeUnmappedSegmentId != null && containsSegmentId) {
        // Highlight (parts of) the mesh as active
        this.updateMeshAppearance(obj, undefined, true, indexRange);
      } else if (obj.activeState) {
        // The mesh has an activeState, but that id is no longer
        // active. Therefore, clear it.
        this.updateMeshAppearance(obj, undefined, false, null);
      }
    });
  };

  throttledHighlightActiveUnmappedSegmentId = _.throttle(
    this.highlightActiveUnmappedSegmentId,
    150,
  );
}
