// @flow
import * as React from "react";
import { Icon, Alert, Dropdown, Menu } from "antd";
import { connect } from "react-redux";
import Store from "oxalis/store";
import {
  layoutEmitter,
  deleteLayout,
  getLayoutConfig,
  addNewLayout,
} from "oxalis/view/layouting/layout_persistence";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import TracingActionsView, { ResetLayoutItem } from "oxalis/view/action-bar/tracing_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import AddNewLayoutModal from "oxalis/view/action-bar/add_new_layout_modal";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { Mode, ControlMode } from "oxalis/constants";
import type { OxalisState, Tracing } from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";
import type { LayoutKeys } from "oxalis/view/layouting/default_layout_configs";

const VersionRestoreWarning = (
  <Alert
    message="Read-only version restore mode active!"
    style={{ padding: "4px 15px" }}
    type="info"
  />
);

type StateProps = {
  viewMode: Mode,
  controlMode: ControlMode,
  tracing: Tracing,
  showVersionRestore: boolean,
};

type Props = StateProps & {
  storedLayoutNamesForView: Array<string>,
  activeLayout: string,
  layoutKey: LayoutKeys,
  setCurrentLayout: string => void,
};

type State = {
  isNewLayoutModalVisible: boolean,
};

// eslint-disable-next-line react/prefer-stateless-function
class ActionBarView extends React.PureComponent<Props, State> {
  state = {
    isNewLayoutModalVisible: false,
  };

  handleResetLayout = () => {
    Store.dispatch(updateUserSettingAction("layoutScaleValue", 1));
    layoutEmitter.emit("resetLayout", this.props.layoutKey, this.props.activeLayout);
  };

  handleLayoutDeleted = (layoutName: string) => {
    deleteLayout(this.props.layoutKey, layoutName);
  };

  addNewLayout = (layoutName: string) => {
    this.setState({ isNewLayoutModalVisible: false });
    const configForLayout = getLayoutConfig(this.props.layoutKey, this.props.activeLayout);
    if (addNewLayout(this.props.layoutKey, layoutName, configForLayout)) {
      this.props.setCurrentLayout(layoutName);
    }
  };

  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const hasVolume = this.props.tracing.volume != null;
    const hasSkeleton = this.props.tracing.skeleton != null;
    const isVolumeSupported = !Constants.MODES_ARBITRARY.includes(this.props.viewMode);
    const resetItemProps = {
      storedLayoutNamesForView: this.props.storedLayoutNamesForView,
      layoutKey: this.props.layoutKey,
      activeLayout: this.props.activeLayout,
      onResetLayout: this.handleResetLayout,
      onSelectLayout: this.props.setCurrentLayout,
      onDeleteLayout: this.handleLayoutDeleted,
      addNewLayout: () => {
        this.setState({ isNewLayoutModalVisible: true });
      },
    };
    const readonlyDropdown = (
      <Dropdown overlay={<Menu>{<ResetLayoutItem {...resetItemProps} />}</Menu>}>
        <ButtonComponent>
          <Icon type="down" />
        </ButtonComponent>
      </Dropdown>
    );

    return (
      <React.Fragment>
        <div className="action-bar">
          {isTraceMode && !this.props.showVersionRestore ? (
            <TracingActionsView {...resetItemProps} />
          ) : (
            readonlyDropdown
          )}
          {this.props.showVersionRestore ? VersionRestoreWarning : null}
          <DatasetPositionView />
          {hasVolume && isVolumeSupported ? <VolumeActionsView /> : null}
          {hasSkeleton && isTraceMode ? <ViewModesView /> : null}
        </div>
        <AddNewLayoutModal
          addLayout={this.addNewLayout}
          visible={this.state.isNewLayoutModalVisible}
          onCancel={() => this.setState({ isNewLayoutModalVisible: false })}
        />
      </React.Fragment>
    );
  }
}
const mapStateToProps = (state: OxalisState): StateProps => ({
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  tracing: state.tracing,
  showVersionRestore: state.uiInformation.showVersionRestore,
});

export default connect(mapStateToProps)(ActionBarView);
