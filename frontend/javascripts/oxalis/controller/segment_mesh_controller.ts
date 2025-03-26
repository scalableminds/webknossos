import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
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

const ACTIVATED_COLOR = [0.7, 0.5, 0.1] as const;
const HOVERED_COLOR = [0.65, 0.5, 0.1] as const;

type MeshMaterial = THREE.MeshLambertMaterial & { savedHex?: number };
export type MeshSceneNode = THREE.Mesh<THREE.BufferGeometry, MeshMaterial> & {
  unmappedSegmentId?: number | null;
  isMerged?: boolean;
  isActiveUnmappedSegment?: boolean;
  isHovered?: boolean;
  parent: SceneGroupForMeshes;
};
export type SceneGroupForMeshes = THREE.Group & { segmentId: number; children: MeshSceneNode[] };
export type BufferGeometryWithInfo = THREE.BufferGeometry & {
  unmappedSegmentId: number;
  isMerged?: boolean;
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

    bufferGeometry = mergeVertices(bufferGeometry);
    bufferGeometry.computeVertexNormals();

    this.addMeshFromGeometry(
      bufferGeometry as BufferGeometryWithInfo,
      segmentId,
      null,
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
      color,
    });
    meshMaterial.side = THREE.FrontSide;
    meshMaterial.transparent = true;

    // mesh.parent is still null at this moment, but when the mesh is
    // added to the group later, parent will be set. We'll ignore
    // this detail for now via the casting.
    const mesh = new THREE.Mesh(geometry, meshMaterial) as any as MeshSceneNode;

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
        500,
      )
      .onUpdate(function onUpdate(this: { opacity: number }) {
        meshMaterial.opacity = this.opacity;
        app.vent.emit("rerender");
      })
      .start();

    if ("unmappedSegmentId" in geometry) {
      mesh.unmappedSegmentId = geometry.unmappedSegmentId as number | null;
    }
    if ("isMerged" in geometry) {
      mesh.isMerged = geometry.isMerged;
    }

    return mesh;
  }

  addMeshFromGeometries(
    geometries: BufferGeometryWithInfo[],
    segmentId: number,
    offset: Vector3 | null = null,
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
      if (offset) {
        meshChunk.translateX(offset[0]);
        meshChunk.translateY(offset[1]);
        meshChunk.translateZ(offset[2]);
      }
      return meshChunk;
    });
    const group = new THREE.Group() as SceneGroupForMeshes;
    for (const meshChunk of meshChunks) {
      group.add(meshChunk);
    }
    group.segmentId = segmentId;
    this.addMeshToMeshGroups(additionalCoordinatesString, layerName, segmentId, lod, group);

    const segmentationTracing = getActiveSegmentationTracing(Store.getState());
    if (segmentationTracing != null) {
      // addMeshFromGeometries is often called multiple times for different sets of geometries.
      // Therefore, used a throttled variant of the highlightUnmappedSegmentId method.
      this.throttledHighlightUnmappedSegmentId(segmentationTracing.activeUnmappedSegmentId);
    }
  }

  addMeshFromGeometry(
    geometry: BufferGeometryWithInfo,
    segmentId: number,
    offset: Vector3 | null = null,
    scale: Vector3 | null = null,
    lod: number,
    layerName: string,
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
  ): void {
    this.addMeshFromGeometries(
      [geometry],
      segmentId,
      offset,
      scale,
      lod,
      layerName,
      additionalCoordinates,
    );
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

  setMeshColor(id: number, layerName: string, opacity?: number): void {
    const color = this.getColorObjectForSegment(id, layerName);
    // If in nd-dataset, set the color for all additional coordinates
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentId)) {
      const meshDataForOneSegment = recordsOfLayers[layerName][id];
      if (meshDataForOneSegment != null) {
        for (const lodGroup of Object.values(meshDataForOneSegment)) {
          for (const meshGroup of lodGroup.children) {
            meshGroup.children.forEach((child: MeshSceneNode) => {
              child.material.color = color;
              if (opacity != null) child.material.opacity = opacity;
            });
          }
        }
      }
    }
  }

  setMeshOpacity(id: number, layerName: string, opacity: number): void {
    // If in nd-dataset, set the opacity for all additional coordinates
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentId)) {
      const meshDataForOneSegment = recordsOfLayers[layerName][id];
      if (meshDataForOneSegment != null) {
        for (const lodGroup of Object.values(meshDataForOneSegment)) {
          for (const meshGroup of lodGroup.children) {
            meshGroup.children.forEach((child: MeshSceneNode) => {
              child.material.opacity = opacity;
            });
          }
        }
      }
    }
  }

  getColorObjectForSegment(segmentId: number, layerName: string) {
    const [hue, saturation, light] = getSegmentColorAsHSLA(Store.getState(), segmentId, layerName);
    const color = new THREE.Color().setHSL(hue, 0.75 * saturation, light / 10);
    return color;
  }

  addLights(): void {
    // Note that the PlaneView also attaches a directional light directly to the TD camera,
    // so that the light moves along the cam.
    const AMBIENT_INTENSITY = 30;
    const DIRECTIONAL_INTENSITY = 5;
    const POINT_INTENSITY = 5;

    const ambientLight = new THREE.AmbientLight(2105376, AMBIENT_INTENSITY);

    const directionalLight = new THREE.DirectionalLight(16777215, DIRECTIONAL_INTENSITY);
    directionalLight.position.x = 1;
    directionalLight.position.y = 1;
    directionalLight.position.z = 1;
    directionalLight.position.normalize();

    const directionalLight2 = new THREE.DirectionalLight(16777215, DIRECTIONAL_INTENSITY);
    directionalLight2.position.x = -1;
    directionalLight2.position.y = -1;
    directionalLight2.position.z = -1;
    directionalLight2.position.normalize();

    const pointLight = new THREE.PointLight(16777215, POINT_INTENSITY);
    pointLight.position.x = 0;
    pointLight.position.y = -25;
    pointLight.position.z = 10;

    this.meshesLODRootGroup.add(ambientLight);
    this.meshesLODRootGroup.add(directionalLight);
    this.meshesLODRootGroup.add(directionalLight2);
    this.meshesLODRootGroup.add(pointLight);
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
  ) {
    let wasChanged = false;
    if (isHovered != null) {
      if (!!mesh.isHovered !== isHovered) {
        mesh.isHovered = isHovered;
        wasChanged = true;
      }
    }
    if (isActiveUnmappedSegment != null) {
      if (!!mesh.isActiveUnmappedSegment !== isActiveUnmappedSegment) {
        mesh.isActiveUnmappedSegment = isActiveUnmappedSegment;
        wasChanged = true;
      }
    }
    if (!wasChanged) {
      // Nothing to do
      return;
    }

    const targetOpacity = mesh.material.opacity * (mesh.isHovered ? 0.8 : 1.0);

    // mesh.parent contains all geometries that were loaded
    // for one chunk (if isMerged is true, this is only one geometry).
    // mesh.parent.parent contains all chunks for the current segment.
    const parent = mesh.parent.parent;
    if (parent == null) {
      // Satisfy TS
      throw new Error("Unexpected null parent");
    }
    // We update the opacity for all meshes that belong to the current
    // segment ID (in contrast to the color) so that the user can
    // see which other super voxels belong to the segment id of the
    // hovered super-voxel.
    parent.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material.opacity = targetOpacity;
      }
    });
    const isNotProofreadingMode = Store.getState().uiInformation.activeTool !== "PROOFREAD";

    const changeMaterial = (fn: (material: MeshMaterial) => void) => {
      if (mesh.isMerged || isNotProofreadingMode) {
        // Update the material for all meshes that belong to the current
        // segment ID.
        parent.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            fn(child.material);
          }
        });
      } else {
        // Only update the given mesh, because we only want to highlight
        // that super-voxel.
        fn(mesh.material);
      }
    };
    if (mesh.isHovered || mesh.isActiveUnmappedSegment) {
      changeMaterial((material) => {
        if (material.savedHex == null) {
          material.savedHex = material.color.getHex();
        }
        const newColor: readonly [number, number, number] = mesh.isHovered
          ? HOVERED_COLOR
          : ACTIVATED_COLOR;
        material.color = new THREE.Color().setHSL(...newColor);
        material.emissive.setHSL(...HOVERED_COLOR);
      });
    } else {
      changeMaterial((material) => {
        // @ts-ignore
        material.emissive.setHex("#FF00FF");
        if (material.savedHex != null) {
          material.color.setHex(material.savedHex);
        }
        material.savedHex = undefined;
      });
    }
  }

  highlightUnmappedSegmentId = (activeUnmappedSegmentId: number | null | undefined) => {
    const { meshesLODRootGroup } = this;
    meshesLODRootGroup.traverse((_obj) => {
      // The cast is safe because MeshSceneNode adds only optional properties
      const obj = _obj as MeshSceneNode;
      if (activeUnmappedSegmentId != null && obj.unmappedSegmentId === activeUnmappedSegmentId) {
        this.updateMeshAppearance(obj, undefined, true);
      } else if (obj.isActiveUnmappedSegment) {
        this.updateMeshAppearance(obj, undefined, false);
      }
    });
  };

  throttledHighlightUnmappedSegmentId = _.throttle(this.highlightUnmappedSegmentId, 150);
}
