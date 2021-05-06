// @flow
import { Tooltip, Radio } from "antd";
import { useSelector, useDispatch } from "react-redux";
import React from "react";

import { setMergerModeEnabledAction } from "oxalis/model/actions/skeletontracing_actions";
import { document } from "libs/window";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { narrowButtonStyle } from "./volume_actions_view";

export default function SkeletonActionsView() {
  const dispatch = useDispatch();
  const isMergerModeEnabled = useSelector(
    state => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const isNewNodeNewTreeModeOn = useSelector(state => state.userConfiguration.newNodeNewTree);
  const toggleNewNodeNewTreeMode = () =>
    dispatch(updateUserSettingAction("newNodeNewTree", !isNewNodeNewTreeModeOn));
  const toggleMergerMode = () => dispatch(setMergerModeEnabledAction(!isMergerModeEnabled));
  const imgStyle = {
    width: 22,
    height: 22,
    lineHeight: 10,
    marginTop: -2,
  };
  return (
    <div
      onClick={() => {
        if (document.activeElement) document.activeElement.blur();
      }}
    >
      <Tooltip title="Toggle the Single node Tree (soma clicking) mode">
        <Radio.Group value={isNewNodeNewTreeModeOn ? "active" : null}>
          <Radio.Button style={narrowButtonStyle} value="active" onClick={toggleNewNodeNewTreeMode}>
            <img
              style={imgStyle}
              src="/assets/images/soma-clicking-icon.svg"
              alt="Single Node Tree Mode"
            />
          </Radio.Button>
        </Radio.Group>
      </Tooltip>
      <Tooltip title="Toggle Merger Mode">
        <Radio.Group value={isMergerModeEnabled ? "active" : null}>
          <Radio.Button style={narrowButtonStyle} value="active" onClick={toggleMergerMode}>
            <img style={imgStyle} src="/assets/images/merger-mode-icon.svg" alt="Merger Mode" />
          </Radio.Button>
        </Radio.Group>
      </Tooltip>
    </div>
  );
}
