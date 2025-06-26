import update from "immutability-helper";
import type { Action } from "viewer/model/actions/actions";
import type { WebknossosState } from "viewer/store";

export const applyActionsOnReadOnlyVersion = (
  applyActions: (
    state: WebknossosState,
    actionGetters: Array<Action | ((s: WebknossosState) => Action)>,
  ) => WebknossosState,
  state: WebknossosState,
  actionGetters: Array<Action | ((s: WebknossosState) => Action)>,
) => {
  const readOnlyState = overrideAllowUpdateInState(state, false);
  const reappliedNewState = applyActions(readOnlyState, actionGetters);

  return overrideAllowUpdateInState(reappliedNewState, true);
};

function overrideAllowUpdateInState(state: WebknossosState, value: boolean) {
  return update(state, {
    annotation: {
      restrictions: {
        allowUpdate: {
          $set: value,
        },
      },
    },
  });
}
