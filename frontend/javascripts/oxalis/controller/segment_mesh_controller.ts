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
import Store, { Flycam, OxalisState } from "oxalis/store";
import { AdditionalCoordinate } from "types/api_flow_types";
import { getAdditionalCoordinatesAsString, getAdditionalCoordinatesAsStringFromFC } from "oxalis/model/accessors/flycam_accessor";
import { connect } from "react-redux";
import React from "react";

type StateProps = {
  flycam: Flycam;
}

type State = {
  // meshesLODRootGroup holds lights and one group per segmentation id.
  // Each group can hold multiple meshes.
  meshesLODRootGroup: CustomLOD;
  meshesGroupsPerSegmentationId: Record<
    string,
    Record<string, Record<number, Record<number, THREE.Group>>>>;
}

class SegmentMeshController extends React.PureComponent<StateProps, State>{

  state: State = {
    meshesLODRootGroup: new CustomLOD(),
    meshesGroupsPerSegmentationId: {}
  };

  componentDidMount(): void {
    this.addLights();
  }


  hasMesh(id: number, layerName: string): boolean {
    const additionalCoordinates = getAdditionalCoordinatesAsStringFromFC(Store.getState().flycam);

    if (
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates] == null ||
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName] == null
    )
      return false;

    const segments = this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName];
    if (!segments) {
      return false;
    }
    return segments[id] != null;
  }

  addMeshFromVertices(vertices: Float32Array, segmentationId: number, layerName: string): void {
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
  ): void {
    const additionalCoordinates = getAdditionalCoordinatesAsStringFromFC(this.props.flycam);
    if (this.state.meshesGroupsPerSegmentationId[additionalCoordinates] == null) {
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates] = {};
    }

    if (this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName] == null) {
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName] = {};
    }
    if (
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId] == null
    ) {
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId] = {};
    }
    if (
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId][lod] ==
      null
    ) {
      const newGroup = new THREE.Group();
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId][lod] =
        newGroup;
      if (lod === NO_LOD_MESH_INDEX) {
        this.state.meshesLODRootGroup.addNoLODSupportedMesh(newGroup);
      } else {
        this.state.meshesLODRootGroup.addLODMesh(newGroup, lod);
      }
      // @ts-ignore
      newGroup.cellId = segmentationId;
      if (scale != null) {
        newGroup.scale.copy(new THREE.Vector3(...scale));
      }
    }
    const mesh = this.constructMesh(segmentationId, geometry);
    if (offset) {
      mesh.translateX(offset[0]);
      mesh.translateY(offset[1]);
      mesh.translateZ(offset[2]);
    }
    this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId][lod].add(
      mesh,
    );
  }

  removeMeshById(segmentationId: number, layerName: string): void {
    const additionalCoordinates = getAdditionalCoordinatesAsStringFromFC(Store.getState().flycam);

    // TODO I think it shouldnt be possible to remove meshes that arent visible currently.
    // but if they are removed they should be removed for all timestamps
    if (this.state.meshesGroupsPerSegmentationId[additionalCoordinates] == null) {
      return;
    }
    if (this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName] == null) {
      return;
    }
    if (
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId] == null
    ) {
      return;
    }
    _.forEach(
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId],
      (meshGroup, lod) => {
        const lodNumber = parseInt(lod);
        if (lodNumber !== NO_LOD_MESH_INDEX) {
          this.state.meshesLODRootGroup.removeLODMesh(meshGroup, lodNumber);
        } else {
          this.state.meshesLODRootGroup.removeNoLODSupportedMesh(meshGroup);
        }
      },
    );
    delete this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentationId];
  }

  getMeshGeometryInBestLOD(segmentId: number, layerName: string): THREE.Group {
    const additionalCoordinates = getAdditionalCoordinatesAsStringFromFC(this.props.flycam);

    const bestLod = Math.min(
      ...Object.keys(
        this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentId],
      ).map((lodVal) => parseInt(lodVal)),
    );
    return this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][segmentId][bestLod];
  }

  setMeshVisibility(
    id: number,
    visibility: boolean,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): void {
    console.log("setMeshVis", id, visibility, layerName, additionalCoordinates);
    const additionalCoordinatesString = getAdditionalCoordinatesAsString(additionalCoordinates||null);

    if (this.state.meshesGroupsPerSegmentationId[additionalCoordinatesString] == null) {
      return; //TODO think about 3D only
    }

    _.forEach(
      this.state.meshesGroupsPerSegmentationId[additionalCoordinatesString][layerName][id],
      (meshGroup) => {
        meshGroup.visible = visibility;
      },
    );
  }

  setMeshColor(id: number, layerName: string): void {
    const additionalCoordinates = getAdditionalCoordinatesAsStringFromFC(this.props.flycam);
    const color = this.getColorObjectForSegment(id);
    _.forEach(
      this.state.meshesGroupsPerSegmentationId[additionalCoordinates][layerName][id],
      (meshGroup) => {
        if (meshGroup) {
          for (const child of meshGroup.children) {
            // @ts-ignore
            child.material.color = color;
          }
        }
      },
    );
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

    this.state.meshesLODRootGroup.add(ambientLight);
    this.state.meshesLODRootGroup.add(directionalLight);
    this.state.meshesLODRootGroup.add(directionalLight2);
    this.state.meshesLODRootGroup.add(pointLight);
  }

}

const mapStateToProps = (state: OxalisState): StateProps=>{
  return {
    flycam: state.flycam
  }
}

const connector = connect(mapStateToProps);
export default connector(SegmentMeshController);