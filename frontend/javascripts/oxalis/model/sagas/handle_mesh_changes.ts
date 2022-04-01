import type {
  CreateMeshFromBufferAction,
  DeleteMeshAction,
  UpdateLocalMeshMetaDataAction,
  UpdateRemoteMeshMetaDataAction,
} from "oxalis/model/actions/annotation_actions";
import {
  addMeshMetaDataAction,
  updateLocalMeshMetaDataAction,
} from "oxalis/model/actions/annotation_actions";
import type { MeshMetaData } from "types/api_flow_types";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
// import { _all, _call, _takeEvery, call, put, select } from "oxalis/model/sagas/effect-generators";
import { all, call, takeEvery, put } from "typed-redux-saga";
import {
  createMesh,
  deleteMesh as deleteMeshFromServer,
  updateMeshMetaData,
} from "admin/admin_rest_api";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
import getMeshBufferFromStore, { addMeshBufferToStore } from "oxalis/model/mesh_store";
import getSceneController from "oxalis/controller/scene_controller_provider";
import parseStlBuffer from "libs/parse_stl_buffer";
import { BufferGeometry } from "three";

function* handleDeleteMesh(action: DeleteMeshAction): Saga<void> {
  const { id } = action;
  yield* put(
    updateLocalMeshMetaDataAction(id, {
      isLoading: true,
    }),
  );
  yield* call(deleteMeshFromServer, id);
  const SceneController = yield* call(getSceneController);
  SceneController.removeSTL(id);
  yield* put(
    updateLocalMeshMetaDataAction(id, {
      isLoading: false,
    }),
  );
}

function* handleVisibilityChange(meshMetaData: MeshMetaData, isVisible: boolean): Saga<void> {
  const { id } = meshMetaData;
  const SceneController = yield* call(getSceneController);

  if (meshMetaData.isLoaded) {
    SceneController.setMeshVisibility(id, isVisible);
  } else if (isVisible) {
    yield* put(
      updateLocalMeshMetaDataAction(id, {
        isLoading: true,
      }),
    );
    const meshBuffer = yield* call(getMeshBufferFromStore, id);

    if (meshBuffer != null) {
      const geometry = yield* call(parseStlBuffer, meshBuffer);
      yield* call({context: SceneController, fn: SceneController.addSTL}, meshMetaData, geometry);
      yield* put(
        updateLocalMeshMetaDataAction(id, {
          isLoaded: true,
        }),
      );
    }

    yield* put(
      updateLocalMeshMetaDataAction(id, {
        isLoading: false,
      }),
    );
  }
}

function* handleRemoteUpdateMesh(action: UpdateRemoteMeshMetaDataAction): Saga<void> {
  const { id } = action;
  const meshMetaData = yield* select((state) => state.tracing.meshes.find((m) => m.id === id));

  if (!meshMetaData) {
    return;
  }

  const SceneController = yield* call(getSceneController);
  SceneController.updateMeshPostion(id, meshMetaData.position);
  yield* put(
    updateLocalMeshMetaDataAction(id, {
      isLoading: true,
    }),
  );

  /* eslint no-unused-vars: ["error", { "ignoreRestSiblings": true }] */
  const { isVisible, isLoaded, isLoading, ...remoteMetadata } = meshMetaData;
  yield* call(updateMeshMetaData, remoteMetadata);
  yield* put(
    updateLocalMeshMetaDataAction(id, {
      isLoading: false,
    }),
  );
}

function* handleLocalUpdateMesh(action: UpdateLocalMeshMetaDataAction): Saga<void> {
  const { id } = action;
  const meshMetaData = yield* select((state) => state.tracing.meshes.find((m) => m.id === id));

  if (!meshMetaData) {
    return;
  }

  const { isVisible } = action.meshShape;

  if (isVisible != null) {
    yield* handleVisibilityChange(meshMetaData, isVisible);
  }
}

function* createMeshFromBuffer(action: CreateMeshFromBufferAction): Saga<void> {
  const annotationId = yield* select((store) => store.tracing.annotationId);
  const allowUpdate = yield* select((store) => store.tracing.restrictions.allowUpdate);

  if (!allowUpdate) {
    return;
  }

  // Parse and persist STL in parallel
  const STLOperationResults = yield* all([
    call(parseStlBuffer, action.buffer),
    call(
      createMesh,
      {
        annotationId,
        position: [0, 0, 0],
        description: action.name,
      },
      action.buffer,
    ),
  ]);

  const geometry = STLOperationResults[0] as BufferGeometry
  const meshMetaData = STLOperationResults[1] as MeshMetaData;

  const SceneController = yield* call(getSceneController);
  yield* call({context: SceneController, fn: SceneController.addSTL}, meshMetaData, geometry);
  yield * put(addMeshMetaDataAction(meshMetaData as MeshMetaData));
  yield* put(
    updateLocalMeshMetaDataAction(meshMetaData.id, {
      isLoaded: true,
    }),
  );
  yield* call(addMeshBufferToStore, meshMetaData.id, action.buffer);
  yield* put(
    updateLocalMeshMetaDataAction(meshMetaData.id, {
      isVisible: true,
    }),
  );
  yield* put(setImportingMeshStateAction(false));
}

export default function* handleMeshChanges(): Saga<void> {
  yield* takeEvery("DELETE_MESH", handleDeleteMesh);
  yield* takeEvery("UPDATE_LOCAL_MESH_METADATA", handleLocalUpdateMesh);
  yield* takeEvery("UPDATE_REMOTE_MESH_METADATA", handleRemoteUpdateMesh);
  yield* takeEvery("CREATE_MESH_FROM_BUFFER", createMeshFromBuffer);
}
