import { Button, Dropdown, type MenuProps, Space } from "antd";
import * as Utils from "libs/utils";
import { useCallback } from "react";

import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import { type ViewMode, ViewModeValues } from "viewer/constants";
import constants from "viewer/constants";
import {
  setFlightmodeRecordingAction,
  setViewModeAction,
} from "viewer/model/actions/settings_actions";
import { NARROW_BUTTON_STYLE } from "./tools/tool_helpers";

const VIEW_MODE_TO_ICON = {
  [constants.MODE_PLANE_TRACING]: <i className="fas fa-th-large" />,
  [constants.MODE_ARBITRARY]: <i className="fas fa-globe" />,
  [constants.MODE_ARBITRARY_PLANE]: (
    <i className="fas fa-square-full" style={{ transform: "scale(0.8, 1) rotate(-45deg)" }} />
  ),
};

function ViewModesView() {
  const viewMode = useWkSelector((state) => state.temporaryConfiguration.viewMode);
  const allowedModes = useWkSelector((state) => state.annotation.restrictions.allowedModes);
  const dispatch = useDispatch();

  const onChangeFlightmodeRecording = useCallback(
    (value: boolean) => {
      dispatch(setFlightmodeRecordingAction(value));
    },
    [dispatch],
  );

  const handleChange: MenuProps["onClick"] = (args) => {
    if (!ViewModeValues.includes(args.key as ViewMode)) {
      return;
    }
    const mode = args.key as ViewMode;
    // If we switch back from any arbitrary mode we stop recording.
    // This prevents that when the user switches back to any arbitrary mode,
    // a new node is instantly created at the screen's center.
    if (constants.MODES_ARBITRARY.includes(viewMode) && mode === constants.MODE_PLANE_TRACING) {
      onChangeFlightmodeRecording(false);
    }

    dispatch(setViewModeAction(mode));
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
    args.domEvent.target.blur();
  };

  const isDisabled = (mode: ViewMode) => {
    return !allowedModes.includes(mode);
  };

  const MENU_ITEMS: MenuProps["items"] = [
    {
      key: "1",
      type: "group",
      label: "Select View Mode",
      children: ViewModeValues.map((mode) => ({
        label: Utils.capitalize(mode),
        key: mode,
        disabled: isDisabled(mode),
        icon: <span style={{ marginRight: 8 }}>{VIEW_MODE_TO_ICON[mode]}</span>,
      })),
    },
  ];

  const menuProps = {
    items: MENU_ITEMS,
    onClick: handleChange,
  };

  return (
    <Dropdown menu={menuProps}>
      <Button style={NARROW_BUTTON_STYLE}>
        <Space>{VIEW_MODE_TO_ICON[viewMode]}</Space>
      </Button>
    </Dropdown>
  );
}

export default ViewModesView;
