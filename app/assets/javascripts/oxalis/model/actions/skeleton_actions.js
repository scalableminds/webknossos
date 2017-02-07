/* eslint-disable import/prefer-default-export */

/**
 * skeleton_actions.js
 * @flow
 */

export type ActionType = {
  type: string
};

export const deleteActiveNodeAction = (): ActionType => ({
  type: "DELETE_ACTIVE_NODE",
});

