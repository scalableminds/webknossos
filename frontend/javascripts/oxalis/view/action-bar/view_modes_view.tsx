import { Button, Dropdown, type MenuProps, Space } from "antd";
import * as Utils from "libs/utils";
import { type ViewMode, ViewModeValues } from "oxalis/constants";
import constants from "oxalis/constants";
import {
  setFlightmodeRecordingAction,
  setViewModeAction,
} from "oxalis/model/actions/settings_actions";
import type { AllowedMode, OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import { PureComponent } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import type { EmptyObject } from "types/globals";
import { NARROW_BUTTON_STYLE } from "./toolbar_view";

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
  handleChange = (mode: ViewMode) => {
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
    // Unfortunately, antd doesn't provide the original event here
    // which is why we have to blur using document.activeElement.
    // Additionally, we need a timeout since the blurring would be done
    // to early, otherwise.
    setTimeout(() => {
      if (document.activeElement != null) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
        document.activeElement.blur();
      }
    }, 100);
  };

  isDisabled(mode: ViewMode) {
    return !this.props.allowedModes.includes(mode);
  }

  render() {
    const handleMenuClick: MenuProps["onClick"] = (args) => {
      if (ViewModeValues.includes(args.key as ViewMode)) {
        this.handleChange(args.key as ViewMode);
      }
    };

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
      onClick: handleMenuClick,
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

function mapStateToProps(state: OxalisState): StateProps {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    allowedModes: state.annotation.restrictions.allowedModes,
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(ViewModesView);
