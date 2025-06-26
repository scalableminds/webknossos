import update from "immutability-helper";
import type { WebknossosState } from "viewer/store";

export const transformStateAsReadOnly = (
  state: WebknossosState,
  transformFn: (state: WebknossosState) => WebknossosState,
) => {
  /*
   * This function can be used to make a state read only before
   * transforming it somehow (e.g., with a reducer). The result of
   * the transformation is then made not-read-only again.
   */
  const readOnlyState = overrideAllowUpdateInState(state, false);
  const transformedState = transformFn(readOnlyState);

  return overrideAllowUpdateInState(transformedState, true);
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
