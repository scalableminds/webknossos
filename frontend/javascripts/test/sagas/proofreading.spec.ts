import { put, take } from "redux-saga/effects";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { proofreadMerge } from "viewer/model/actions/proofread_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe.skip("Proofreading", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("shouldn't do anything if unchanged (saga test)", async (_context: WebknossosTestContext) => {
    const { annotation } = Store.getState();
    // console.log("annotation.skeleton", annotation.skeleton);
    // console.log("annotation.volumes", annotation.volumes);
    const { tracingId } = annotation.volumes[0];

    /*
    SET_MAPPING
    FINISH_MAPPING_INITIALIZATION
      dispatched by
        Mappings.updateMappingTextures
        MappingSaga.reloadData
          triggered by handleSetHdf5Mapping and when the bucket retrieval source changed between REQUESTED-WITH-MAPPING <> REQUESTED-WITHOUT-MAPPING
    */

    const task = startSaga(function* () {
      yield put(setMappingAction(tracingId, sampleHdf5AgglomerateName, "HDF5"));
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield put(proofreadMerge([0, 0, 0], 1, 2));
    });

    await task.toPromise();
  }, 4000);
});
