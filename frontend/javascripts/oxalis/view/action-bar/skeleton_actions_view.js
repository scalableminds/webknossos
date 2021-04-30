// @flow
import { Button, Tooltip } from "antd";
import { useSelector, useDispatch } from "react-redux";
import React from "react";

import { setMergerModeEnabledAction } from "oxalis/model/actions/skeletontracing_actions";
import { document } from "libs/window";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";

export default function SkeletonActionsView() {
  const dispatch = useDispatch();
  const isMergerModeEnabled = useSelector(
    state => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const activeStyle = { borderColor: "pink", padding: "0px 5px" };
  const isNewNodeNewTreeModeOn = useSelector(state => state.userConfiguration.newNodeNewTree);
  return (
    <div
      onClick={() => {
        if (document.activeElement) document.activeElement.blur();
      }}
    >
      <Tooltip title="Toggle the Single node Tree (soma clicking) mode">
        <Button
          type="button"
          style={isNewNodeNewTreeModeOn ? activeStyle : { padding: "0px 5px" }}
          onClick={() =>
            dispatch(updateUserSettingAction("newNodeNewTree", !isNewNodeNewTreeModeOn))
          }
        >
          <img src="/assets/images/soma-clicking-icon.svg" alt="Single Node Tree Mode" />
        </Button>
      </Tooltip>
      <Tooltip title="Toggle Merger Mode">
        <Button
          type="button"
          style={isMergerModeEnabled ? activeStyle : { padding: "0px 5px" }}
          onClick={() => dispatch(setMergerModeEnabledAction(!isMergerModeEnabled))}
        >
          <img src="/assets/images/merger-mode-icon.svg" alt="Merger Mode" />
        </Button>
      </Tooltip>
    </div>
  );
}
