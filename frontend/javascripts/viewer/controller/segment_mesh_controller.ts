import app from "app";
import { mergeVertices } from "libs/BufferGeometryUtils";
import { computeBvhAsync } from "libs/compute_bvh_async";
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
  MeshLambertMaterial,
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
import Store, { type MinCutPartitions } from "viewer/store";
import { type BufferGeometryWithInfo, extractSubGeometry } from "./mesh_helpers";

// Add the raycast function. Assumes the BVH is available on
// the `boundsTree` variable
Mesh.prototype.raycast = acceleratedRaycast;

const hslToSRGB = (hsl: Vector3) => new Color().setHSL(...hsl).convertSRGBToLinear();

const WHITE = new Color(1, 1, 1);
const ACTIVATED_COLOR = hslToSRGB([0.7, 0.9, 0.75]);
const HOVERED_COLOR = hslToSRGB([0.65, 0.9, 0.75]);
const PARTITION_COLORS = {
  1: [0.2, 0.2, 0.2] as Vector3,
  2: [0.7, 0.7, 0.7] as Vector3,
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

function forEachLodGroup<T>(
  groupsByLod: Record<number, T> | null | undefined,
  callback: (group: T, lod: number) => void,
): void {
  if (groupsByLod == null) return;
  for (const [lodStr, group] of Object.entries(groupsByLod)) {
    callback(group, Number.parseInt(lodStr, 10));
  }
}

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

  getLoadedLods(
    id: bigint,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): number[] {
    const meshGroups = this.getMeshGroups(
      getAdditionalCoordinatesAsString(additionalCoordinates),
      layerName,
      id,
    );
    const lods: number[] = [];
    forEachLodGroup(meshGroups, (_group, lod) => lods.push(lod));
    return lods;
  }

  /**
   * Returns the unmapped/supervoxel ids already present (via vertexSegmentMapping) in id's
   * geometry at a given LOD. Used by the proofreading merge orchestration to diff a freshly
   * listed chunk set against what's already loaded, so only the missing ("delta") chunks are
   * fetched (see segment_and_mesh_refresh_sagas.ts). Chunks without a vertexSegmentMapping
   * (ad-hoc meshes) contribute nothing.
   */
  getLoadedUnmappedSegmentIds(
    id: bigint,
    layerName: string,
    lod: number,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): Set<bigint> {
    const ids = new Set<bigint>();
    const targetGroup = this.getMeshGroupsByLOD(additionalCoordinates, layerName, id, lod);
    if (targetGroup == null) return ids;
    for (const chunkGroup of targetGroup.children as SceneGroupForMeshes[]) {
      for (const node of chunkGroup.children) {
        const vertexSegmentMapping = node.geometry.vertexSegmentMapping;
        if (vertexSegmentMapping != null) {
          for (const segmentId of vertexSegmentMapping.unmappedSegmentIds) {
            ids.add(segmentId);
          }
        }
      }
    }
    return ids;
  }

  /**
   * Union of getLoadedUnmappedSegmentIds across every LOD id currently has geometry for. Used by
   * the proofreading split orchestration to find the full set of supervoxel ids that need to be
   * classified into their post-split agglomerate ids (see segment_and_mesh_refresh_sagas.ts).
   */
  getAllLoadedUnmappedSegmentIds(
    id: bigint,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): Set<bigint> {
    let ids = new Set<bigint>();
    for (const lod of this.getLoadedLods(id, layerName, additionalCoordinates)) {
      ids = ids.union(this.getLoadedUnmappedSegmentIds(id, layerName, lod, additionalCoordinates));
    }
    return ids;
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

    forEachLodGroup(meshGroups, (meshGroup, currentLod) => {
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

  /**
   * Renames all scene-graph bookkeeping for oldSegmentId to newSegmentId without touching any
   * geometry - a pure rename/reparent, no network calls, no disposal. If newSegmentId already
   * has mesh groups for a given LOD (i.e. both sides of a proofreading merge are already
   * loaded), oldSegmentId's chunk groups are reparented into the existing target group instead
   * of replacing it, so both meshes' geometry ends up combined under newSegmentId.
   *
   * Callers are responsible for dispatching the corresponding Redux mesh-info update (so that
   * `MeshInformation` stays in sync with the scene graph) and, if colors may now be stale (the
   * merge case, since reparented chunks keep whichever color they were constructed with), calling
   * `setMeshColor(newSegmentId, layerName)` afterwards.
   */
  moveMeshesToNewSegmentId(
    oldSegmentId: bigint,
    newSegmentId: bigint,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): void {
    if (oldSegmentId === newSegmentId) return;
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const oldMeshGroups = this.getMeshGroups(additionalCoordKey, layerName, oldSegmentId);
    if (oldMeshGroups == null) return;
    const layerLODGroup = this.getLODGroupOfLayer(layerName);
    if (layerLODGroup == null) return;

    forEachLodGroup(oldMeshGroups, (oldTargetGroup, lod) => {
      const existingNewTargetGroup = this.getMeshGroupsByLOD(
        additionalCoordinates,
        layerName,
        newSegmentId,
        lod,
      );
      // oldTargetGroup is the per-(segment, LOD) container ("GroupForLOD"), whose children are
      // the individual chunk wrapper groups (SceneGroupForMeshes) - addMeshFromGeometry also
      // stamps `segmentId` directly onto this container, even though that's not reflected in the
      // GroupForLOD type declared on meshesGroupsPerSegmentId.
      const oldGroup = oldTargetGroup as GroupForLOD & { segmentId: bigint };

      if (existingNewTargetGroup == null) {
        // Nothing exists yet for newSegmentId at this LOD: just re-key the existing group in our
        // bookkeeping. The group's position in the actual three.js scene graph doesn't change.
        oldGroup.segmentId = newSegmentId;
        for (const child of oldGroup.children) {
          child.segmentId = newSegmentId;
        }
        setWith(
          this.meshesGroupsPerSegmentId,
          [additionalCoordKey, layerName, newSegmentId.toString(), lod],
          oldTargetGroup,
          Object,
        );
      } else {
        // A mesh already exists for newSegmentId at this LOD: reparent every chunk group of the
        // old mesh into the existing target group (three.js Object3D.add() reparents
        // automatically, removing the child from its previous parent), then discard the now-empty
        // old target group.
        for (const child of [...oldGroup.children]) {
          child.segmentId = newSegmentId;
          existingNewTargetGroup.add(child);
        }
        if (lod === NO_LOD_MESH_INDEX) {
          layerLODGroup.removeNoLODSupportedMesh(oldTargetGroup);
        } else {
          layerLODGroup.removeLODMesh(oldTargetGroup, lod);
        }
      }
    });

    this.removeMeshFromMeshGroups(additionalCoordKey, layerName, oldSegmentId);
  }

  /**
   * Collects every chunk node of oldSegmentId's mesh, grouped by LOD, and validates that all of
   * them carry a vertexSegmentMapping (i.e. it's a precomputed mesh that merged successfully, not
   * an ad-hoc mesh or a precomputed mesh that fell back to unmerged chunks). Returns null without
   * any side effects if oldSegmentId has no mesh or fails that check, so callers can decide to
   * fall back to a full reload *before* touching Redux/scene state - see
   * canSplitMeshLocally/splitMeshByUnmappedSegmentIds below.
   */
  private collectSplittableNodesByLod(
    oldSegmentId: bigint,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): Array<{ lod: number; scale: ThreeVector3; nodes: MeshSceneNode[] }> | null {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const oldMeshGroups = this.getMeshGroups(additionalCoordKey, layerName, oldSegmentId);
    if (oldMeshGroups == null) return null;

    const nodesByLod: Array<{ lod: number; scale: ThreeVector3; nodes: MeshSceneNode[] }> = [];
    forEachLodGroup(oldMeshGroups, (targetGroup, lod) => {
      const nodes: MeshSceneNode[] = [];
      for (const chunkGroup of targetGroup.children as SceneGroupForMeshes[]) {
        for (const node of chunkGroup.children) {
          if (node.geometry.vertexSegmentMapping == null) {
            return null;
          }
          nodes.push(node);
        }
      }
      nodesByLod.push({ lod, scale: targetGroup.scale.clone(), nodes });
    });
    return nodesByLod;
  }

  /**
   * Pure feasibility check for splitMeshByUnmappedSegmentIds below - no side effects. Callers can
   * check this first, dispatch the corresponding Redux mesh-info changes only once they know the
   * split will actually succeed, and only then call splitMeshByUnmappedSegmentIds - avoiding a
   * window where Redux and the scene graph could end up inconsistent if the split failed partway.
   */
  canSplitMeshLocally(
    oldSegmentId: bigint,
    layerName: string,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): boolean {
    return this.collectSplittableNodesByLod(oldSegmentId, layerName, additionalCoordinates) != null;
  }

  /**
   * Locally splits oldSegmentId's mesh into one mesh per entry of newIdToKeepIds, by slicing the
   * vertex ranges belonging to each entry's unmapped/supervoxel ids out of the existing merged
   * geometry (see extractSubGeometry in mesh_helpers.ts) - no network round-trip. Only works for
   * meshes whose chunk geometries carry a vertexSegmentMapping (precomputed/mesh-file meshes);
   * returns false without mutating anything if oldSegmentId has no mesh, or if any of its chunk
   * geometries lack a vertexSegmentMapping (ad-hoc meshes, or a precomputed mesh that fell back to
   * unmerged chunks) - callers should check canSplitMeshLocally first and fall back to a full
   * reload if it returns false, rather than relying on this method's own (equivalent) check.
   *
   * Callers must dispatch the Redux mesh-info entries for every id in newIdToKeepIds *before*
   * calling this (mirroring how addPrecomputedMeshAction/addAdHocMeshAction are always dispatched
   * before the corresponding addMeshFromGeometry call elsewhere), since addMeshFromGeometry reads
   * the new segment's isVisible from the store when first creating its target group.
   */
  async splitMeshByNewMapping(
    oldSegmentId: bigint,
    layerName: string,
    newAgglomerateIdToSegmentIds: Map<bigint, Set<bigint>>,
    opacity: number | undefined,
    additionalCoordinates?: AdditionalCoordinate[] | null,
  ): Promise<boolean> {
    const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
    const nodesByLod = this.collectSplittableNodesByLod(
      oldSegmentId,
      layerName,
      additionalCoordinates,
    );
    if (nodesByLod == null) return false;

    for (const { lod, scale, nodes } of nodesByLod) {
      for (const [newSegmentId, keepIds] of newAgglomerateIdToSegmentIds) {
        for (const node of nodes) {
          const subGeometry = extractSubGeometry(node.geometry, keepIds);
          if (subGeometry == null) continue;
          subGeometry.boundsTree = await computeBvhAsync(subGeometry);
          this.addMeshFromGeometry(
            subGeometry,
            newSegmentId,
            null,
            lod,
            layerName,
            additionalCoordinates,
            opacity,
            true,
          );
          // addMeshFromGeometry only derives a scale from its `scale` param when it creates a
          // brand-new target group; make sure the new group matches the source group's scale
          // (dataset/mag-derived) regardless of whether this was its first chunk or not.
          const newTargetGroup = this.getMeshGroupsByLOD(
            additionalCoordinates,
            layerName,
            newSegmentId,
            lod,
          );
          if (newTargetGroup) {
            newTargetGroup.scale.copy(scale);
          } else {
            throw new Error(
              `Meshes added to scene for ${additionalCoordinates}, ${layerName}, ${newSegmentId}, ${lod} could not be found.`,
            );
          }
        }
      }
    }

    // Remove exactly the old (pre-split) chunk nodes collected above - not a blanket
    // removeMeshById(oldSegmentId, ...), since one of newIdToKeepIds' keys may equal
    // oldSegmentId (e.g. a min-cut that keeps the original id for one of its two output pieces),
    // in which case the newly split-off chunks were appended into that very same target group
    // above and must survive this cleanup.
    const layerLODGroup = this.getLODGroupOfLayer(layerName);
    for (const { lod, nodes } of nodesByLod) {
      for (const node of nodes) {
        const chunkGroup = node.parent;
        this.disposeMeshGroup(chunkGroup);
        chunkGroup.parent?.remove(chunkGroup);
      }
      // If nothing but the now-removed old chunks lived under this LOD, oldSegmentId isn't one of
      // the new ids - drop the now-empty target group too.
      const targetGroup = this.getMeshGroupsByLOD(
        additionalCoordinates,
        layerName,
        oldSegmentId,
        lod,
      );
      if (targetGroup != null && targetGroup.children.length === 0) {
        if (layerLODGroup != null) {
          if (lod === NO_LOD_MESH_INDEX) {
            layerLODGroup.removeNoLODSupportedMesh(targetGroup);
          } else {
            layerLODGroup.removeLODMesh(targetGroup, lod);
          }
        }
        this.removeMeshLODFromMeshGroups(additionalCoordKey, layerName, oldSegmentId, lod);
      }
    }
    // Also drop the top-level oldSegmentId bookkeeping entry if every LOD ended up empty/removed
    // (i.e. oldSegmentId isn't one of the new ids).
    const remainingMeshGroups = this.getMeshGroups(additionalCoordKey, layerName, oldSegmentId);
    if (remainingMeshGroups == null || Object.keys(remainingMeshGroups).length === 0) {
      this.removeMeshFromMeshGroups(additionalCoordKey, layerName, oldSegmentId);
    }

    return true;
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
    forEachLodGroup(this.getMeshGroups(additionalCoordKey, layerName, id), (meshGroup) => {
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
      forEachLodGroup(meshDataForOneSegment, (lodGroup) => {
        for (const meshGroup of lodGroup.children) {
          meshGroup.children.forEach(functionToApply);
        }
      });
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
        // @ts-expect-error
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
        for (const partitionNumber of [1, 2] as const) {
          const partitionColor = PARTITION_COLORS[partitionNumber];
          for (const segmentId of minCutPartitions[partitionNumber]) {
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

  destroy(): void {
    this.throttledUpdateActiveUnmappedSegmentIdHighlighting.cancel();
    // Dispose all mesh groups (across all additional coordinates) so that
    // their geometries and materials are freed on the GPU.
    for (const recordsOfLayers of Object.values(this.meshesGroupsPerSegmentId)) {
      for (const recordsOfSegments of Object.values(recordsOfLayers)) {
        for (const recordsOfLODs of Object.values(recordsOfSegments)) {
          forEachLodGroup(recordsOfLODs, (meshGroup) => this.disposeMeshGroup(meshGroup));
        }
      }
    }
    this.meshesGroupsPerSegmentId = {};
  }
}
