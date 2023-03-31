// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import * as THREE from "three";
import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
import CustomLOD from "oxalis/controller/custom_lod";
import { getSegmentColorAsHSLA } from "oxalis/model/accessors/volumetracing_accessor";
import { NO_LOD_MESH_INDEX } from "oxalis/model/sagas/isosurface_saga";
import Store from "oxalis/store";

export default class MeshController {
  // isosurfacesRootGroup holds lights and one group per segmentation id.
  // Each group can hold multiple meshes.
  isosurfacesLODRootGroup: CustomLOD;
  isosurfacesGroupsPerSegmentationId: Record<string, Record<number, Record<number, THREE.Group>>> =
    {};

  constructor() {
    this.isosurfacesLODRootGroup = new CustomLOD();
  }

  addIsosurfaceFromVertices(
    vertices: Float32Array,
    segmentationId: number,
    layerName: string,
  ): void {
    let bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

    bufferGeometry = mergeVertices(bufferGeometry);
    bufferGeometry.computeVertexNormals();

    this.addIsosurfaceFromGeometry(
      bufferGeometry,
      segmentationId,
      null,
      null,
      NO_LOD_MESH_INDEX,
      layerName,
    );
  }

  constructIsosurfaceMesh(segmentId: number, geometry: THREE.BufferGeometry) {
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
        app.vent.trigger("rerender");
      })
      .start();
    return mesh;
  }

  addIsosurfaceFromGeometry(
    geometry: THREE.BufferGeometry,
    segmentationId: number,
    offset: Vector3 | null = null,
    scale: Vector3 | null = null,
    lod: number,
    layerName: string,
  ): void {
    if (this.isosurfacesGroupsPerSegmentationId[layerName] == null) {
      this.isosurfacesGroupsPerSegmentationId[layerName] = {};
    }
    if (this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId] == null) {
      this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId] = {};
    }
    if (this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId][lod] == null) {
      const newGroup = new THREE.Group();
      this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId][lod] = newGroup;
      if (lod === NO_LOD_MESH_INDEX) {
        this.isosurfacesLODRootGroup.addNoLODSupportedMesh(newGroup);
      } else {
        this.isosurfacesLODRootGroup.addLODMesh(newGroup, lod);
      }
      // @ts-ignore
      newGroup.cellId = segmentationId;
      if (scale != null) {
        newGroup.scale.copy(new THREE.Vector3(...scale));
      }
    }
    const mesh = this.constructIsosurfaceMesh(segmentationId, geometry);
    if (offset) {
      mesh.translateX(offset[0]);
      mesh.translateY(offset[1]);
      mesh.translateZ(offset[2]);
    }

    this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId][lod].add(mesh);
  }

  removeIsosurfaceById(segmentationId: number, layerName: string): void {
    if (this.isosurfacesGroupsPerSegmentationId[layerName] == null) {
      return;
    }
    if (this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId] == null) {
      return;
    }
    _.forEach(
      this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId],
      (meshGroup, lod) => {
        const lodNumber = parseInt(lod);
        if (lodNumber !== NO_LOD_MESH_INDEX) {
          this.isosurfacesLODRootGroup.removeLODMesh(meshGroup, lodNumber);
        } else {
          this.isosurfacesLODRootGroup.removeNoLODSupportedMesh(meshGroup);
        }
      },
    );
    delete this.isosurfacesGroupsPerSegmentationId[layerName][segmentationId];
  }

  getIsosurfaceGeometryInBestLOD(segmentId: number, layerName: string): THREE.Group {
    const bestLod = Math.min(
      ...Object.keys(this.isosurfacesGroupsPerSegmentationId[layerName][segmentId]).map((lodVal) =>
        parseInt(lodVal),
      ),
    );
    return this.isosurfacesGroupsPerSegmentationId[layerName][segmentId][bestLod];
  }

  setIsosurfaceVisibility(id: number, visibility: boolean, layerName: string): void {
    _.forEach(this.isosurfacesGroupsPerSegmentationId[layerName][id], (meshGroup) => {
      meshGroup.visible = visibility;
    });
  }

  setIsosurfaceColor(id: number, layerName: string): void {
    const color = this.getColorObjectForSegment(id);
    _.forEach(this.isosurfacesGroupsPerSegmentationId[layerName][id], (meshGroup) => {
      if (meshGroup) {
        for (const child of meshGroup.children) {
          // @ts-ignore
          child.material.color = color;
        }
      }
    });
  }

  getColorObjectForSegment(segmentId: number) {
    const [hue, saturation, light] = getSegmentColorAsHSLA(Store.getState(), segmentId);
    const color = new THREE.Color().setHSL(hue, 0.75 * saturation, light / 10);
    return color;
  }
}
