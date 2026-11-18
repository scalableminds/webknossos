import {
  Box3,
  type Camera,
  Group,
  LOD,
  MathUtils,
  Matrix4,
  type Mesh,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { OrthoViews } from "viewer/constants";
import { getInputCatcherRect } from "viewer/model/accessors/view_mode_accessor";
import Store from "viewer/store";

// A LOD only switches to a coarser level once the pixel size exceeds the threshold by
// this fraction (and back to the finer level once it falls below it by the same
// fraction). Otherwise, segments right at a threshold would flicker while orbiting.
const LOD_HYSTERESIS = 0.1;

// Returns the voxel size (in mag-1 voxels along x) up to which the given LOD is
// detailed enough. These values were tuned for the orthographic 3D viewport and
// are interpreted as "how many voxels does one screen pixel cover at the mesh".
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

function getVoxelsPerPixelAtDistance(camera: Camera, distance: number): number {
  const state = Store.getState();
  const { height } = getInputCatcherRect(state, OrthoViews.TDView);
  const voxelSizeX = state.dataset.dataSource.scale.factor[0];
  return getWorldUnitsPerPixel(camera, distance, Math.max(height, 1)) / voxelSizeX;
}

// Same estimate as SegmentLOD.update() uses, but at the depth of the 3D viewport's
// orbit target, where the orthographic and the perspective camera agree.
// Used to prioritize loading LODs before a segment's position is known.
export function getLODIndexForTDViewTarget(maxLevel: number): number {
  const state = Store.getState();
  const { width } = getInputCatcherRect(state, OrthoViews.TDView);
  const { tdCamera } = state.viewModeData.plane;
  const voxelSizeX = state.dataset.dataSource.scale.factor[0];
  const voxelsPerPixel = (tdCamera.right - tdCamera.left) / (Math.max(width, 1) * voxelSizeX);
  return getLODIndexForVoxelsPerPixel(voxelsPerPixel, maxLevel);
}

const _cameraPosition = new Vector3();
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
  lodLevelCount: number;
  private currentLevel: number | undefined;
  // The bounding box of all meshes in the local space of this object.
  // It's null when it needs to be recomputed (e.g., after a chunk was added).
  private localBoundingBox: Box3 | null = null;

  constructor() {
    super();
    this.lodLevelCount = 0;
    this.noLODGroup = new Group();
    this.add(this.noLODGroup);
  }

  // Only the meshes contained in the levels are relevant for raycasting.
  // The VisibilityAwareRaycaster traverses into the visible levels itself.
  raycast() {}

  invalidateBoundingBox() {
    this.localBoundingBox = null;
  }

  private computeLocalBoundingBox(): Box3 {
    const box = new Box3();
    this.updateWorldMatrix(true, true);
    _inverseMatrixWorld.copy(this.matrixWorld).invert();
    this.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry.boundingBox == null) {
        mesh.geometry.computeBoundingBox();
      }
      if (mesh.geometry.boundingBox == null) return;
      _meshToLocal.multiplyMatrices(_inverseMatrixWorld, mesh.matrixWorld);
      box.union(_meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(_meshToLocal));
    });
    return box;
  }

  private getDistanceToCamera(camera: Camera): number {
    if (this.localBoundingBox == null) {
      this.localBoundingBox = this.computeLocalBoundingBox();
    }
    if (this.localBoundingBox.isEmpty()) {
      _worldBox.makeEmpty().expandByPoint(new Vector3().setFromMatrixPosition(this.matrixWorld));
    } else {
      _worldBox.copy(this.localBoundingBox).applyMatrix4(this.matrixWorld);
    }
    _cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    // Use the closest point of the segment, so that large segments which extend
    // towards the camera are rendered in high detail. Is 0 if the camera is inside.
    return _worldBox.distanceToPoint(_cameraPosition);
  }

  getLevelIndexForCamera(camera: Camera): number {
    const maxIndex = this.lodLevelCount - 1;
    if (maxIndex <= 0) {
      return 0;
    }
    const distance = (camera as PerspectiveCamera).isPerspectiveCamera
      ? this.getDistanceToCamera(camera)
      : 0;
    const voxelsPerPixel = getVoxelsPerPixelAtDistance(camera, distance);
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

  addNoLODSupportedMesh(meshGroup: Group) {
    this.noLODGroup.add(meshGroup);
    this.invalidateBoundingBox();
  }

  addLODMesh(meshGroup: Group, level: number) {
    while (this.lodLevelCount <= level) {
      this.addLevel(new Group(), this.lodLevelCount);
      this.lodLevelCount++;
    }
    this.levels[level].object.add(meshGroup);
    this.invalidateBoundingBox();
  }

  removeNoLODSupportedMesh(meshGroup: Group) {
    this.noLODGroup.remove(meshGroup);
    this.invalidateBoundingBox();
  }

  removeLODMesh(meshGroup: Group, level: number) {
    this.levels[level].object.remove(meshGroup);
    this.invalidateBoundingBox();
  }

  isEmpty(): boolean {
    return (
      this.noLODGroup.children.length === 0 &&
      this.levels.every((level) => level.object.children.length === 0)
    );
  }
}
