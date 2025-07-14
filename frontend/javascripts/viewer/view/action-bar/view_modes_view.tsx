import { Button, Dropdown, type MenuProps, Space } from "antd";
import * as Utils from "libs/utils";
import { PureComponent } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import type { EmptyObject } from "types/globals";
import { type ViewMode, ViewModeValues } from "viewer/constants";
import constants from "viewer/constants";
import {
  setFlightmodeRecordingAction,
  setViewModeAction,
} from "viewer/model/actions/settings_actions";
import type { AllowedMode, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import { NARROW_BUTTON_STYLE } from "./tools/tool_helpers";

type StateProps = {
  viewMode: ViewMode;
  allowedModes: Array<AllowedMode>;
};
type DispatchProps = {
  onChangeFlightmodeRecording: (arg0: boolean) => void;
};
type Props = StateProps & DispatchProps;

const VIEW_MODE_TO_ICON = {
  [constants.MODE_PLANE_TRACING]: <i className="fas fa-th-large" />,
  [constants.MODE_ARBITRARY]: <i className="fas fa-globe" />,
  [constants.MODE_ARBITRARY_PLANE]: (
    <i className="fas fa-square-full" style={{ transform: "scale(0.8, 1) rotate(-45deg)" }} />
  ),
};

class ViewModesView extends PureComponent<Props, EmptyObject> {
  handleChange: MenuProps["onClick"] = (args) => {
    if (!ViewModeValues.includes(args.key as ViewMode)) {
      return;
    }
    const mode = args.key as ViewMode;
    // If we switch back from any arbitrary mode we stop recording.
    // This prevents that when the user switches back to any arbitrary mode,
    // a new node is instantly created at the screen's center.
    if (
      constants.MODES_ARBITRARY.includes(this.props.viewMode) &&
      mode === constants.MODE_PLANE_TRACING
    ) {
      this.props.onChangeFlightmodeRecording(false);
    }

    Store.dispatch(setViewModeAction(mode));
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
    args.domEvent.target.blur();
  };

  isDisabled(mode: ViewMode) {
    return !this.props.allowedModes.includes(mode);
  }

  render() {
    const MENU_ITEMS: MenuProps["items"] = [
      {
        key: "1",
        type: "group",
        label: "Select View Mode",
        children: ViewModeValues.map((mode) => ({
          label: Utils.capitalize(mode),
          key: mode,
          disabled: this.isDisabled(mode),
          icon: <span style={{ marginRight: 8 }}>{VIEW_MODE_TO_ICON[mode]}</span>,
        })),
      },
    ];

    const menuProps = {
      items: MENU_ITEMS,
      onClick: this.handleChange,
    };

    return (
      <Dropdown menu={menuProps}>
        <Button style={NARROW_BUTTON_STYLE}>
          <Space>{VIEW_MODE_TO_ICON[this.props.viewMode]}</Space>
        </Button>
      </Dropdown>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  onChangeFlightmodeRecording(value: boolean) {
    dispatch(setFlightmodeRecordingAction(value));
  },
});

function mapStateToProps(state: WebknossosState): StateProps {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    allowedModes: state.annotation.restrictions.allowedModes,
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(ViewModesView);
