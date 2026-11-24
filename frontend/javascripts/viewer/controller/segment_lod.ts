import {
  Box3,
  type Camera,
  Group,
  LOD,
  MathUtils,
  Matrix4,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { OrthoViews } from "viewer/constants";
import { getGlobalVoxelSizeFromState } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getInputCatcherRect, getTDViewZoom } from "viewer/model/accessors/view_mode_accessor";
import { getUnitPerPixel } from "viewer/model/scaleinfo";
import Store, { type WebknossosState } from "viewer/store";

// A LOD only switches to a coarser level once the pixel size exceeds the threshold by
// this fraction (and back to the finer level once it falls below it by the same
// fraction). Otherwise, segments right at a threshold would flicker while orbiting.
const LOD_HYSTERESIS = 0.1;

// Returns the voxel size (in mag-1 voxels along the smallest voxel extent, like the
// zoom of the 3D viewport) up to which the given LOD is detailed enough. These values
// were tuned for the orthographic 3D viewport and are interpreted as "how many voxels
// does one screen pixel cover at the mesh".
export function getLODThresholdForLevel(level: number): number {
  if (level === 0) {
    return 0.7;
  }
  // This will return 3 for level 1 and then double for each additional level
  return 2 ** (level - 1) * 3;
}

// Picks the coarsest LOD whose geometric detail is still sufficient for the given
// pixel size. If currentLevel is passed, a hysteresis band around each threshold
// prevents switching back and forth when voxelsPerPixel hovers near a threshold.
export function getLODIndexForVoxelsPerPixel(
  voxelsPerPixel: number,
  maxLevel: number,
  currentLevel?: number,
): number {
  let index = 0;
  while (index < maxLevel) {
    const threshold = getLODThresholdForLevel(index);
    const hysteresisFactor =
      currentLevel == null ? 1 : index < currentLevel ? 1 - LOD_HYSTERESIS : 1 + LOD_HYSTERESIS;
    if (voxelsPerPixel <= threshold * hysteresisFactor) {
      break;
    }
    index++;
  }
  return index;
}

// Returns how many world units one screen pixel covers at the given distance from
// the camera. For a perspective camera, this grows linearly with the distance. For an
// orthographic camera, there is no foreshortening, so the distance is irrelevant and
// the pixel size only depends on the frustum size (i.e., the zoom level).
export function getWorldUnitsPerPixel(
  camera: Camera,
  distance: number,
  viewportHeightPx: number,
): number {
  if ((camera as PerspectiveCamera).isPerspectiveCamera) {
    const { fov, zoom } = camera as PerspectiveCamera;
    const visibleHeight = 2 * distance * Math.tan(MathUtils.degToRad(fov) / 2);
    return visibleHeight / (zoom * viewportHeightPx);
  }
  const { top, bottom, zoom } = camera as OrthographicCamera;
  return (top - bottom) / (zoom * viewportHeightPx);
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true;
}

// The pixel size only depends on the camera, the viewport and the voxel size, but not on
// the segment. Since it's needed for every segment in every frame, it's cached until one
// of these inputs changes (the store state is immutable, so comparing it is enough).
const pixelSizeCache = {
  camera: null as Camera | null,
  state: null as WebknossosState | null,
  frustumSize: Number.NaN,
  zoom: Number.NaN,
  voxelsPerPixelFactor: Number.NaN,
};

// For the orthographic camera, returns how many voxels one screen pixel covers.
// For the perspective camera, this grows linearly with the distance, so the value
// at a distance of 1 is returned.
function getVoxelsPerPixelFactor(camera: PerspectiveCamera | OrthographicCamera): number {
  const state = Store.getState();
  const frustumSize = isPerspectiveCamera(camera) ? camera.fov : camera.top - camera.bottom;
  const cache = pixelSizeCache;
  if (
    cache.camera !== camera ||
    cache.state !== state ||
    cache.frustumSize !== frustumSize ||
    cache.zoom !== camera.zoom
  ) {
    const { height } = getInputCatcherRect(state, OrthoViews.TDView);
    // Like getTDViewZoom, this is relative to the smallest extent of the global voxel size.
    const unitPerVoxel = getUnitPerPixel(getGlobalVoxelSizeFromState(state));
    cache.camera = camera;
    cache.state = state;
    cache.frustumSize = frustumSize;
    cache.zoom = camera.zoom;
    cache.voxelsPerPixelFactor =
      getWorldUnitsPerPixel(camera, 1, Math.max(height, 1)) / unitPerVoxel;
  }
  return cache.voxelsPerPixelFactor;
}

function getVoxelsPerPixelAtDistance(camera: Camera, distance: number): number {
  const factor = getVoxelsPerPixelFactor(camera as PerspectiveCamera | OrthographicCamera);
  return isPerspectiveCamera(camera) ? factor * distance : factor;
}

// Same estimate as SegmentLOD.update() uses, but at the depth of the 3D viewport's
// orbit target, where the orthographic and the perspective camera agree.
// Used to prioritize loading LODs before a segment's position is known.
export function getLODIndexForTDViewTarget(maxLevel: number): number {
  return getLODIndexForVoxelsPerPixel(getTDViewZoom(Store.getState()), maxLevel);
}

const _cameraPosition = new Vector3();
const _segmentPosition = new Vector3();
const _worldBox = new Box3();
const _meshBox = new Box3();
const _inverseMatrixWorld = new Matrix4();
const _meshToLocal = new Matrix4();

// Holds the meshes of a single segment in all available LODs and shows the LOD
// that matches the screen-space size of the segment. For the perspective camera,
// this depends on the distance between the camera and the segment, so that segments
// in the back are rendered with less detail than those in the front.
// Meshes that don't support LODs (e.g., ad-hoc meshes) are always visible.
export default class SegmentLOD extends LOD {
  noLODGroup: Group;
  // Only used for the perspective camera, see getLevelIndexForCamera.
  private currentLevel: number | undefined;
  // The bounding box of all meshes in the local space of this object.
  // It's null when it needs to be recomputed (e.g., after a chunk was added).
  private localBoundingBox: Box3 | null = null;

  constructor() {
    super();
    this.noLODGroup = new Group();
    this.add(this.noLODGroup);
  }

  // Only the meshes contained in the levels are relevant for raycasting.
  // The VisibilityAwareRaycaster traverses into the visible levels itself.
  raycast() {}

  // Must be called whenever meshes are removed from this segment, since its bounds
  // might shrink. They are recomputed from all remaining meshes when needed.
  invalidateBoundingBox() {
    this.localBoundingBox = null;
  }

  // Must be called whenever meshes (e.g., a newly loaded chunk) were added to this
  // segment. Only the added meshes are traversed, so that streaming in a segment
  // chunk by chunk doesn't traverse all of its previous chunks again each time.
  expandBoundingBox(addedObject: Object3D) {
    if (this.localBoundingBox == null) {
      // The bounds are computed from all meshes once they are needed.
      return;
    }
    this.unionMeshBoundsInLocalSpace(addedObject, this.localBoundingBox);
  }

  private unionMeshBoundsInLocalSpace(root: Object3D, box: Box3) {
    // Updates the world matrices of root's ancestors (including this object) and of
    // its descendants.
    root.updateWorldMatrix(true, true);
    _inverseMatrixWorld.copy(this.matrixWorld).invert();
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry.boundingBox == null) {
        mesh.geometry.computeBoundingBox();
      }
      if (mesh.geometry.boundingBox == null) return;
      _meshToLocal.multiplyMatrices(_inverseMatrixWorld, mesh.matrixWorld);
      box.union(_meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(_meshToLocal));
    });
  }

  private computeLocalBoundingBox(): Box3 {
    const box = new Box3();
    this.unionMeshBoundsInLocalSpace(this, box);
    return box;
  }

  private getDistanceToCamera(camera: Camera): number {
    if (this.localBoundingBox == null) {
      this.localBoundingBox = this.computeLocalBoundingBox();
    }
    if (this.localBoundingBox.isEmpty()) {
      _worldBox.makeEmpty().expandByPoint(_segmentPosition.setFromMatrixPosition(this.matrixWorld));
    } else {
      _worldBox.copy(this.localBoundingBox).applyMatrix4(this.matrixWorld);
    }
    _cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    // Use the closest point of the segment, so that large segments which extend
    // towards the camera are rendered in high detail. Is 0 if the camera is inside.
    return _worldBox.distanceToPoint(_cameraPosition);
  }

  getLevelIndexForCamera(camera: Camera): number {
    const maxIndex = this.levels.length - 1;
    if (maxIndex <= 0) {
      return 0;
    }
    if (!isPerspectiveCamera(camera)) {
      // With the orthographic camera, all segments share the same LOD. Hysteresis is not
      // applied, because it depends on each segment's previous level (which may still
      // stem from the perspective camera) and would therefore yield different LODs.
      return getLODIndexForVoxelsPerPixel(getVoxelsPerPixelAtDistance(camera, 0), maxIndex);
    }
    const voxelsPerPixel = getVoxelsPerPixelAtDistance(camera, this.getDistanceToCamera(camera));
    return getLODIndexForVoxelsPerPixel(voxelsPerPixel, maxIndex, this.currentLevel);
  }

  // Chunks of a LOD are streamed in. If the desired LOD has no meshes yet,
  // show the closest LOD that has (preferring finer ones) instead of nothing.
  private getClosestLoadedLevel(desiredIndex: number): number {
    const { levels } = this;
    for (let offset = 0; offset < levels.length; offset++) {
      for (const index of [desiredIndex - offset, desiredIndex + offset]) {
        if (index >= 0 && index < levels.length && levels[index].object.children.length > 0) {
          return index;
        }
      }
    }
    return desiredIndex;
  }

  // Called by the WebGLRenderer for every render pass with the camera of that pass
  // (as long as autoUpdate is true and this object is visible).
  update(camera: Camera) {
    const { levels } = this;
    if (levels.length === 0) {
      return;
    }
    const desiredIndex = this.getLevelIndexForCamera(camera);
    this.currentLevel = desiredIndex;
    const visibleIndex = this.getClosestLoadedLevel(desiredIndex);
    for (let i = 0; i < levels.length; i++) {
      levels[i].object.visible = i === visibleIndex;
    }
  }

  // The added groups are filled with mesh chunks afterwards. Callers need to
  // expand the bounding box by each added chunk (see expandBoundingBox).
  addNoLODSupportedMesh(meshGroup: Group) {
    this.noLODGroup.add(meshGroup);
  }

  addLODMesh(meshGroup: Group, level: number) {
    while (this.levels.length <= level) {
      this.addLevel(new Group(), this.levels.length);
    }
    this.levels[level].object.add(meshGroup);
  }

  removeNoLODSupportedMesh(meshGroup: Group) {
    this.noLODGroup.remove(meshGroup);
    this.invalidateBoundingBox();
  }

  removeLODMesh(meshGroup: Group, level: number) {
    this.levels[level].object.remove(meshGroup);
    this.invalidateBoundingBox();
  }
}
