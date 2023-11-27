// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import * as THREE from "three";
import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
import CustomLOD from "oxalis/controller/custom_lod";
import { getSegmentColorAsHSLA } from "oxalis/model/accessors/volumetracing_accessor";
import { NO_LOD_MESH_INDEX } from "oxalis/model/sagas/mesh_saga";
import Store from "oxalis/store";
import { AdditionalCoordinate } from "types/api_flow_types";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";

export default class SegmentMeshController {
  // meshesLODRootGroup holds lights and one group per segmentation id.
  // Each group can hold multiple meshes.
  meshesLODRootGroup: CustomLOD;

  // meshesGroupsPerSegmentationId holds a record for every additionalCoordinatesString, then
  // (nested) for each layerName, and then at the lowest level a group for each segment ID.
  meshesGroupsPerSegmentationId: Record<
    string,
    Record<string, Record<number, Record<number, THREE.Group>>>
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
    segmentationId: number,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[],
  ): void {
    if (vertices.length === 0) return;
    let bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

    bufferGeometry = mergeVertices(bufferGeometry);
    bufferGeometry.computeVertexNormals();

    this.addMeshFromGeometry(
      bufferGeometry,
      segmentationId,
      null,
      null,
      NO_LOD_MESH_INDEX,
      layerName,
      additionalCoordinates || null,
    );
  }

  constructMesh(segmentId: number, geometry: THREE.BufferGeometry) {
    const color = this.getColorObjectForSegment(segmentId);
    const meshMaterial = new THREE.MeshLambertMaterial({
      color,
    });
    meshMaterial.side = THREE.FrontSide;
    meshMaterial.transparent = true;

    const mesh = new THREE.Mesh(geometry, meshMaterial);

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
      .onUpdate(function onUpdate() {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        meshMaterial.opacity = this.opacity;
        app.vent.emit("rerender");
      })
      .start();
    return mesh;
  }

  addMeshFromGeometry(
    geometry: THREE.BufferGeometry,
    segmentationId: number,
    offset: Vector3 | null = null,
    scale: Vector3 | null = null,
    lod: number,
    layerName: string,
    additionalCoordinates: AdditionalCoordinate[] | null,
  ): void {
    const additionalCoordinatesString = getAdditionalCoordinatesAsString(additionalCoordinates);
    const newGroup = new THREE.Group();
    const keys = [additionalCoordinatesString, layerName, segmentationId, lod];
    _.set(
      this.meshesGroupsPerSegmentationId,
      keys,
      _.get(this.meshesGroupsPerSegmentationId, keys, newGroup),
    );
    if (lod === NO_LOD_MESH_INDEX) {
      this.meshesLODRootGroup.addNoLODSupportedMesh(newGroup);
    } else {
      this.meshesLODRootGroup.addLODMesh(newGroup, lod);
    }
    // @ts-ignore
    newGroup.cellId = segmentationId;
    if (scale != null) {
      newGroup.scale.copy(new THREE.Vector3(...scale));
    }
    const mesh = this.constructMesh(segmentationId, geometry);
    if (offset) {
      mesh.translateX(offset[0]);
      mesh.translateY(offset[1]);
      mesh.translateZ(offset[2]);
    }
    this.addMeshToMeshGroups(additionalCoordinatesString, layerName, segmentationId, lod, mesh);
  }

  removeMeshById(
    segmentationId: number,
    layerName: string,
    additionalCoordinates: AdditionalCoordinate[] | null,
  ): void {
    // either remove a mesh for specific additional coordinates, or remove all meshes for a segment per default by passing null as additionalCoordinates.
    let additionalCoordinatesToRemoveMeshes;
    if (additionalCoordinates == null) {
      additionalCoordinatesToRemoveMeshes = Object.keys(this.meshesGroupsPerSegmentationId);
    } else {
      additionalCoordinatesToRemoveMeshes = [
        getAdditionalCoordinatesAsString(additionalCoordinates),
      ];
    }
    for (const additionalCoordinatesString of additionalCoordinatesToRemoveMeshes) {
      if (this.getMeshGroups(additionalCoordinatesString, layerName, segmentationId) == null) {
        return;
      }
      _.forEach(
        this.getMeshGroups(additionalCoordinatesString, layerName, segmentationId),
        (meshGroup, lod) => {
          const lodNumber = parseInt(lod);
          if (lodNumber !== NO_LOD_MESH_INDEX) {
            this.meshesLODRootGroup.removeLODMesh(meshGroup, lodNumber);
          } else {
            this.meshesLODRootGroup.removeNoLODSupportedMesh(meshGroup);
          }
        },
      );
      this.removeMeshFromMeshGroups(additionalCoordinatesString, layerName, segmentationId);
    }
  }

  getMeshGeometryInBestLOD(
    segmentId: number,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): THREE.Group {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const bestLod = Math.min(
      ...Object.keys(this.getMeshGroups(additionalCoordKey, layerName, segmentId)).map((lodVal) =>
        parseInt(lodVal),
      ),
    );
    return this.getMeshGroupsByLOD(additionalCoordinates, layerName, segmentId, bestLod);
  }

  setMeshVisibility(
    id: number,
    visibility: boolean,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): void {
    console.log(
      "if mesh visibility is broken, look into segment mesh controller l. 197.",
      "we stopped checking the records",
    );
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    _.forEach(this.getMeshGroups(additionalCoordKey, layerName, id), (meshGroup) => {
      meshGroup.visible = visibility;
    });
  }

  setMeshColor(id: number, layerName: string): void {
    const color = this.getColorObjectForSegment(id);
    //  if in nd-dataset, set the color for all additional coordinates
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentationId)) {
      const meshDataForOneSegment = recordsOfLayers[layerName][id];
      if (meshDataForOneSegment != null) {
        for (const meshGroup of Object.values(meshDataForOneSegment)) {
          // @ts-ignore
          meshGroup.children.forEach((child) => (child.material.color = color));
        }
      }
    }
  }

  getColorObjectForSegment(segmentId: number) {
    const [hue, saturation, light] = getSegmentColorAsHSLA(Store.getState(), segmentId);
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
    segmentationId: number,
    lod: number,
  ) {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const keys = [additionalCoordKey, layerName, segmentationId, lod];
    return _.get(this.meshesGroupsPerSegmentationId, keys, null);
  }

  getMeshGroups(additionalCoordKey: string, layerName: string, segmentationId: number) {
    const keys = [additionalCoordKey, layerName, segmentationId];
    return _.get(this.meshesGroupsPerSegmentationId, keys, null);
  }

  addMeshToMeshGroups(
    additionalCoordKey: string,
    layerName: string,
    segmentationId: number,
    lod: number,
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>,
  ) {
    this.meshesGroupsPerSegmentationId[additionalCoordKey][layerName][segmentationId][lod].add(
      mesh,
    );
  }

  removeMeshFromMeshGroups(
    additionalCoordinateKey: string,
    layerName: string,
    segmentationId: number,
  ) {
    delete this.meshesGroupsPerSegmentationId[additionalCoordinateKey][layerName][segmentationId];
  }
}
