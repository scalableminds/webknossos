// @flow
import { Tooltip, Space } from "antd";
import { useSelector, useDispatch } from "react-redux";
import React from "react";
import ButtonComponent from "oxalis/view/components/button_component";

import { setMergerModeEnabledAction } from "oxalis/model/actions/skeletontracing_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";

export const narrowButtonStyle = {
  paddingLeft: 10,
  paddingRight: 8,
};

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
    width: 20,
    height: 20,
    lineHeight: 10,
    marginTop: -2,
  };
  const activeButtonStyle = { ...narrowButtonStyle, borderColor: "#1890ff" };
  const newNodeNewTreeModeButtonStyle = isNewNodeNewTreeModeOn
    ? activeButtonStyle
    : narrowButtonStyle;
  const mergerModeButtonStyle = isMergerModeEnabled ? activeButtonStyle : narrowButtonStyle;

  return (
    <Space size={0} className="tight-button-group">
      <Tooltip title="Toggle the Single node Tree (soma clicking) mode">
        <ButtonComponent
          style={newNodeNewTreeModeButtonStyle}
          value="active"
          onClick={toggleNewNodeNewTreeMode}
        >
          <img
            style={imgStyle}
            src="/assets/images/soma-clicking-icon.svg"
            alt="Single Node Tree Mode"
          />
        </ButtonComponent>
      </Tooltip>
      <Tooltip title="Toggle Merger Mode">
        <ButtonComponent style={mergerModeButtonStyle} value="active" onClick={toggleMergerMode}>
          <img style={imgStyle} src="/assets/images/merger-mode-icon.svg" alt="Merger Mode" />
        </ButtonComponent>
      </Tooltip>
    </Space>
  );
}
