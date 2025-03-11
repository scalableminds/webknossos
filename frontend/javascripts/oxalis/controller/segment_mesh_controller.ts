import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import _ from "lodash";
import type { Vector2, Vector3 } from "oxalis/constants";
import CustomLOD from "oxalis/controller/custom_lod";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getSegmentColorAsHSLA,
} from "oxalis/model/accessors/volumetracing_accessor";
import { NO_LOD_MESH_INDEX } from "oxalis/model/sagas/mesh_saga";
import Store from "oxalis/store";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import type { AdditionalCoordinate } from "types/api_flow_types";
import { MeshBVH, MeshBVHHelper, acceleratedRaycast, getBVHExtremes } from "three-mesh-bvh";
import GUI from "lil-gui";

// Add the raycast function. Assumes the BVH is available on
// the `boundsTree` variable
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const hslToSRGB = (hsl: Vector3) =>
  new THREE.Color()
    .setHSL(...hsl)
    .convertSRGBToLinear()
    .toArray() as Vector3;

const ACTIVATED_COLOR = hslToSRGB([0.7, 0.9, 0.75]);
const HOVERED_COLOR = hslToSRGB([0.65, 0.9, 0.75]);

type MeshMaterial = THREE.MeshLambertMaterial & { originalColor: Vector3 };
export type MeshSceneNode = THREE.Mesh<THREE.BufferGeometry, MeshMaterial> & {
  unmappedSegmentId?: number | null;
  hoveredIndicesRange?: Vector2 | null;
  activeIndicesRange?: Vector2 | null;
  parent: SceneGroupForMeshes;
};
export type SceneGroupForMeshes = THREE.Group & { segmentId: number; children: MeshSceneNode[] };

export class PositionToSegmentId {
  cumulativeStartPosition: number[];
  unmappedSegmentIds: number[];
  constructor(sortedBufferGeometries: BufferGeometryWithInfo[]) {
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

export type BufferGeometryWithInfo = THREE.BufferGeometry & {
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

  addMeshFromVertices(
    vertices: Float32Array,
    segmentId: number,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | undefined | null,
  ): void {
    if (vertices.length === 0) return;
    let bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

    // todop: can this cause problems with PositionToSegmentId instances?
    bufferGeometry = mergeVertices(bufferGeometry);
    bufferGeometry.computeVertexNormals();

    this.addMeshFromGeometry(
      bufferGeometry as BufferGeometryWithInfo,
      segmentId,
      null,
      NO_LOD_MESH_INDEX,
      layerName,
      additionalCoordinates,
    );
  }

  constructMesh(
    segmentId: number,
    layerName: string,
    geometry: BufferGeometryWithInfo,
  ): MeshSceneNode {
    const color = this.getColorObjectForSegment(segmentId, layerName);
    const meshMaterial = new THREE.MeshLambertMaterial({
      // color,
      vertexColors: true,
    });
    meshMaterial.side = THREE.FrontSide;
    // todop: would it help to set it to false once the opacity is 1 ? hopefully not...
    meshMaterial.transparent = true;
    const colorArray = color.convertSRGBToLinear().toArray();
    meshMaterial.originalColor = colorArray;
    // todop: necessary?
    // meshMaterial.blending = THREE.NormalBlending;

    // const colorArray: readonly [number, number, number] = HOVERED_COLOR;
    const colorBuffer = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      colorBuffer.set(colorArray, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colorBuffer, 3));

    // mesh.parent is still null at this moment, but when the mesh is
    // added to the group later, parent will be set. We'll ignore
    // this detail for now via the casting.
    const mesh = new THREE.Mesh(geometry, meshMaterial) as any as MeshSceneNode;

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

    if ("unmappedSegmentId" in geometry) {
      mesh.unmappedSegmentId = geometry.unmappedSegmentId as number | null;
    }

    return mesh;
  }

  addMeshFromGeometries(
    geometries: BufferGeometryWithInfo[],
    segmentId: number,
    scale: Vector3 | null = null,
    lod: number,
    layerName: string,
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
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
    const meshChunks = geometries.map((geometry) => {
      const meshChunk = this.constructMesh(segmentId, layerName, geometry);
      meshChunk.geometry.boundsTree = new MeshBVH(meshChunk.geometry);
      // console.log(getBVHExtremes(meshChunk.geometry.boundsTree));
      return meshChunk;
    });
    const group = new THREE.Group() as SceneGroupForMeshes;
    for (const meshChunk of meshChunks) {
      group.add(meshChunk);
      // @ts-ignore todop
      if (window.DEBUG_BVH) {
        const bvhHelper = new MeshBVHHelper(meshChunk);
        bvhHelper.displayParents = true;
        group.add(bvhHelper);
      }
    }
    group.segmentId = segmentId;
    this.addMeshToMeshGroups(additionalCoordinatesString, layerName, segmentId, lod, group);

    const segmentationTracing = getActiveSegmentationTracing(Store.getState());
    if (segmentationTracing != null) {
      // addMeshFromGeometries is often called multiple times for different sets of geometries.
      // Therefore, used a throttled variant of the highlightActiveUnmappedSegmentId method.
      this.throttledHighlightActiveUnmappedSegmentId(segmentationTracing.activeUnmappedSegmentId);
    }
  }

  addMeshFromGeometry(
    geometry: BufferGeometryWithInfo,
    segmentId: number,
    scale: Vector3 | null = null,
    lod: number,
    layerName: string,
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
  ): void {
    this.addMeshFromGeometries([geometry], segmentId, scale, lod, layerName, additionalCoordinates);
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
            meshGroup.children.forEach(
              (child: MeshSceneNode) => (child.material.originalColor = colorArray),
            );
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
        "white",
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

  getMeshGroupsByLOD(
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
    layerName: string,
    segmentId: number,
    lod: number,
  ): THREE.Group | null {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordKey, layerName, segmentId, lod];
    return _.get(this.meshesGroupsPerSegmentId, keys, null);
  }

  getMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentId: number,
  ): Record<number, THREE.Group> | null {
    const keys = [additionalCoordKey, layerName, segmentId];
    return _.get(this.meshesGroupsPerSegmentId, keys, null);
  }

  addMeshToMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentId: number,
    lod: number,
    mesh: SceneGroupForMeshes,
  ) {
    const group = this.meshesGroupsPerSegmentId[additionalCoordKey][layerName][segmentId][lod];
    group.add(mesh);
  }

  removeMeshFromMeshGroups(additionalCoordinateKey: string, layerName: string, segmentId: number) {
    delete this.meshesGroupsPerSegmentId[additionalCoordinateKey][layerName][segmentId];
  }

  updateMeshAppearance(
    mesh: MeshSceneNode,
    isHovered: boolean | undefined,
    isActiveUnmappedSegment?: boolean | undefined,
    indexRange?: Vector2 | null,
  ) {
    let wasChanged = false;
    const rangesToReset: Vector2[] = [];
    if (isHovered != null) {
      if (!_.isEqual(mesh.hoveredIndicesRange, indexRange)) {
        if (mesh.hoveredIndicesRange != null) {
          rangesToReset.push(mesh.hoveredIndicesRange);
        }
        mesh.hoveredIndicesRange = indexRange;
        wasChanged = true;
      }
    }
    if (isActiveUnmappedSegment != null) {
      if (!_.isEqual(mesh.activeIndicesRange, indexRange)) {
        if (mesh.activeIndicesRange != null) {
          rangesToReset.push(mesh.activeIndicesRange);
        }
        mesh.activeIndicesRange = indexRange;
        wasChanged = true;
      }
    }
    if (!wasChanged) {
      // Nothing to do
      return;
    }

    // const targetOpacity = mesh.hoveredIndicesRange ? 0.8 : 1.0;

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
    // const isNotProofreadingMode = Store.getState().uiInformation.activeTool !== "PROOFREAD";
    for (const rangeToReset of rangesToReset) {
      const indexRange = rangeToReset;

      // mesh.material.emissive.setHex("#FF00FF").convertSRGBToLinear();
      if (mesh.material.originalColor != null) {
        for (let index = indexRange[0]; index < indexRange[1]; index++) {
          mesh.geometry.attributes.color.set(mesh.material.originalColor, 3 * index);
        }
      }
    }

    const setRangeToColor = (indexRange: Vector2, color: Vector3) => {
      for (let index = indexRange[0]; index < indexRange[1]; index++) {
        mesh.geometry.attributes.color.set(color, 3 * index);
      }
    };

    if (mesh.hoveredIndicesRange) {
      const newColor = HOVERED_COLOR;
      setRangeToColor(mesh.hoveredIndicesRange, newColor);
    }
    if (mesh.activeIndicesRange) {
      const newColor = ACTIVATED_COLOR;
      setRangeToColor(mesh.activeIndicesRange, newColor);
    }
    mesh.geometry.attributes.color.needsUpdate = true;
  }

  highlightActiveUnmappedSegmentId = (activeUnmappedSegmentId: number | null | undefined) => {
    const { meshesLODRootGroup } = this;
    meshesLODRootGroup.traverse((_obj) => {
      if (!("geometry" in _obj)) {
        return;
      }
      // The cast is safe because MeshSceneNode adds only optional properties
      const obj = _obj as MeshSceneNode;

      const positionToSegmentId = (obj.geometry as BufferGeometryWithInfo).positionToSegmentId;

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
      } else if (obj.activeIndicesRange) {
        // The mesh has an activeIndicesRange, but that id is no longer
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
