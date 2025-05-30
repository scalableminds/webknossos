import { saveAs } from "file-saver";
import ErrorHandling from "libs/error_handling";
import exportToStl from "libs/stl_exporter";
import Toast from "libs/toast";
import Zip from "libs/zipjs_wrapper";
import messages from "messages";
import type * as THREE from "three";
import { all, call, put, take, takeEvery } from "typed-redux-saga";
import getSceneController from "viewer/controller/scene_controller_provider";
import {
  type TriggerMeshDownloadAction,
  type TriggerMeshesDownloadAction,
  type UpdateMeshOpacityAction,
  type UpdateMeshVisibilityAction,
  removeMeshAction,
  updateMeshVisibilityAction,
} from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { stlMeshConstants } from "viewer/view/right-border-tabs/segments_tab/segments_view";
import { getAdditionalCoordinatesAsString } from "../../accessors/flycam_accessor";
import type { FlycamAction } from "../../actions/flycam_actions";
import type {
  BatchUpdateGroupsAndSegmentsAction,
  RemoveSegmentAction,
  UpdateSegmentAction,
} from "../../actions/volumetracing_actions";
import { ensureSceneControllerReady, ensureWkReady } from "../ready_sagas";

export const NO_LOD_MESH_INDEX = -1;

function* downloadMeshCellById(cellName: string, segmentId: number, layerName: string): Saga<void> {
  const { segmentMeshController } = getSceneController();
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const geometry = segmentMeshController.getMeshGeometryInBestLOD(
    segmentId,
    layerName,
    additionalCoordinates,
  );

  if (geometry == null) {
    const errorMessage = messages["tracing.not_mesh_available_to_download"];
    Toast.error(errorMessage, {
      sticky: false,
    });
    return;
  }

  try {
    const blob = getSTLBlob(geometry, segmentId);
    yield* call(saveAs, blob, `${cellName}-${segmentId}.stl`);
  } catch (exception) {
    ErrorHandling.notify(exception as Error);
    Toast.error("Could not export to STL. See console for details");
    console.error(exception);
  }
}

function* downloadMeshCellsAsZIP(
  segments: Array<{ segmentName: string; segmentId: number; layerName: string }>,
): Saga<void> {
  const { segmentMeshController } = getSceneController();
  const zipWriter = new Zip.ZipWriter(new Zip.BlobWriter("application/zip"));
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  try {
    const addFileToZipWriterPromises = segments.map((element) => {
      const geometry = segmentMeshController.getMeshGeometryInBestLOD(
        element.segmentId,
        element.layerName,
        additionalCoordinates,
      );

      if (geometry == null) {
        const errorMessage = messages["tracing.not_mesh_available_to_download"];
        Toast.error(errorMessage, {
          sticky: false,
        });
        return;
      }
      const stlDataReader = new Zip.BlobReader(getSTLBlob(geometry, element.segmentId));
      return zipWriter.add(`${element.segmentName}-${element.segmentId}.stl`, stlDataReader);
    });
    yield all(addFileToZipWriterPromises);
    const result = yield* call([zipWriter, zipWriter.close]);
    yield* call(saveAs, result as Blob, "mesh-export.zip");
  } catch (exception) {
    ErrorHandling.notify(exception as Error);
    Toast.error("Could not export meshes as STL files. See console for details");
    console.error(exception);
  }
}

const getSTLBlob = (geometry: THREE.Group, segmentId: number): Blob => {
  const stlDataViews = exportToStl(geometry);
  // Encode mesh and cell id property
  const { meshMarker, segmentIdIndex } = stlMeshConstants;
  meshMarker.forEach((marker, index) => {
    stlDataViews[0].setUint8(index, marker);
  });
  stlDataViews[0].setUint32(segmentIdIndex, segmentId, true);
  return new Blob(stlDataViews);
};

function* downloadMeshCell(action: TriggerMeshDownloadAction): Saga<void> {
  yield* call(downloadMeshCellById, action.segmentName, action.segmentId, action.layerName);
}

function* downloadMeshCells(action: TriggerMeshesDownloadAction): Saga<void> {
  yield* call(downloadMeshCellsAsZIP, action.segmentsArray);
}

function* handleRemoveSegment(action: RemoveSegmentAction) {
  // The dispatched action will make sure that the mesh entry is removed from the
  // store and from the scene.
  yield* put(removeMeshAction(action.layerName, action.segmentId));
}

function* handleMeshVisibilityChange(action: UpdateMeshVisibilityAction): Saga<void> {
  const { id, visibility, layerName, additionalCoordinates } = action;
  const { segmentMeshController } = yield* call(getSceneController);
  segmentMeshController.setMeshVisibility(id, visibility, layerName, additionalCoordinates);
}

export function* handleAdditionalCoordinateUpdate(): Saga<never> {
  // We want to prevent iterating through all additional coordinates to adjust the mesh visibility, so we store the
  // previous additional coordinates in this method. Thus we have to catch SET_ADDITIONAL_COORDINATES actions in a
  // while-true loop and register this saga in the root saga instead of calling from the mesh saga.
  yield* call(ensureWkReady);

  let previousAdditionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const { segmentMeshController } = yield* call(getSceneController);

  while (true) {
    const action = (yield* take(["SET_ADDITIONAL_COORDINATES"]) as any) as FlycamAction;
    // Satisfy TS
    if (action.type !== "SET_ADDITIONAL_COORDINATES") {
      // Don't throw as this would interfere with the never return type
      console.error("Unexpected action.type. Ignoring SET_ADDITIONAL_COORDINATES action...");
      continue;
    }
    const meshRecords = segmentMeshController.meshesGroupsPerSegmentId;

    if (action.values == null || action.values.length === 0) continue;
    const newAdditionalCoordKey = getAdditionalCoordinatesAsString(action.values);

    for (const additionalCoordinates of [action.values, previousAdditionalCoordinates]) {
      const currentAdditionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
      const shouldBeVisible = currentAdditionalCoordKey === newAdditionalCoordKey;
      const recordsOfLayers = meshRecords[currentAdditionalCoordKey] || {};
      for (const [layerName, recordsForOneLayer] of Object.entries(recordsOfLayers)) {
        const segmentIds = Object.keys(recordsForOneLayer);
        for (const segmentIdAsString of segmentIds) {
          const segmentId = Number.parseInt(segmentIdAsString);
          yield* put(
            updateMeshVisibilityAction(
              layerName,
              segmentId,
              shouldBeVisible,
              additionalCoordinates,
            ),
          );
          yield* call(
            {
              context: segmentMeshController,
              fn: segmentMeshController.setMeshVisibility,
            },
            segmentId,
            shouldBeVisible,
            layerName,
            additionalCoordinates,
          );
        }
      }
    }
    previousAdditionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  }
}

function* handleSegmentColorChange(action: UpdateSegmentAction): Saga<void> {
  const { segmentMeshController } = yield* call(getSceneController);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  if (
    "color" in action.segment &&
    segmentMeshController.hasMesh(action.segmentId, action.layerName, additionalCoordinates)
  ) {
    segmentMeshController.setMeshColor(action.segmentId, action.layerName);
  }
}

function* handleMeshOpacityChange(action: UpdateMeshOpacityAction): Saga<void> {
  const { segmentMeshController } = yield* call(getSceneController);
  segmentMeshController.setMeshOpacity(action.id, action.layerName, action.opacity);
}

function* handleBatchSegmentColorChange(
  batchAction: BatchUpdateGroupsAndSegmentsAction,
): Saga<void> {
  // Manually unpack batched actions and handle these.
  // In theory, this could happen automatically. See this issue in the corresponding (rather unmaintained) package: https://github.com/tshelburne/redux-batched-actions/pull/18
  // However, there seem to be some problems with that approach (e.g., too many updates, infinite recursion) and the discussion there didn't really reach a consensus
  // about the correct solution.
  // This is why we stick to the manual unpacking for now.
  const updateSegmentActions = batchAction.payload
    .filter((action) => action.type === "UPDATE_SEGMENT")
    .map((action) => call(handleSegmentColorChange, action as UpdateSegmentAction));
  yield* all(updateSegmentActions);
}

export default function* commonMeshSaga(): Saga<void> {
  yield* call(ensureSceneControllerReady);
  yield* call(ensureWkReady);
  yield* takeEvery("TRIGGER_MESH_DOWNLOAD", downloadMeshCell);
  yield* takeEvery("TRIGGER_MESHES_DOWNLOAD", downloadMeshCells);
  yield* takeEvery("REMOVE_SEGMENT", handleRemoveSegment);
  yield* takeEvery("UPDATE_MESH_VISIBILITY", handleMeshVisibilityChange);
  yield* takeEvery("UPDATE_SEGMENT", handleSegmentColorChange);
  yield* takeEvery("UPDATE_MESH_OPACITY", handleMeshOpacityChange);
  yield* takeEvery("BATCH_UPDATE_GROUPS_AND_SEGMENTS", handleBatchSegmentColorChange);
}
