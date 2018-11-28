// @flow
import { Icon, Alert, Dropdown, Menu } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import classNames from "classnames";

import type { LayoutKeys } from "oxalis/view/layouting/default_layout_configs";
import {
  layoutEmitter,
  deleteLayout,
  getLayoutConfig,
  addNewLayout,
} from "oxalis/view/layouting/layout_persistence";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import AddNewLayoutModal from "oxalis/view/action-bar/add_new_layout_modal";
import ButtonComponent from "oxalis/view/components/button_component";
import Constants, { type ControlMode, ControlModeEnum, type Mode } from "oxalis/constants";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import Store, { type OxalisState } from "oxalis/store";
import TracingActionsView, { ResetLayoutItem } from "oxalis/view/action-bar/tracing_actions_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";

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
  hasVolume: boolean,
  hasSkeleton: boolean,
  showVersionRestore: boolean,
  isDatasetOnScratchVolume: boolean,
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
    const divClassName = classNames("action-bar", { blink: this.props.isDatasetOnScratchVolume });
    const readonlyDropdown = (
      <Dropdown overlay={<Menu>{<ResetLayoutItem {...resetItemProps} />}</Menu>}>
        <ButtonComponent>
          <Icon type="down" />
        </ButtonComponent>
      </Dropdown>
    );

    return (
      <React.Fragment>
        <div className={divClassName}>
          {isTraceMode && !this.props.showVersionRestore ? (
            <TracingActionsView {...resetItemProps} />
          ) : (
            readonlyDropdown
          )}
          {this.props.showVersionRestore ? VersionRestoreWarning : null}
          <DatasetPositionView />
          {this.props.hasVolume && isVolumeSupported ? <VolumeActionsView /> : null}
          {this.props.hasSkeleton && isTraceMode ? <ViewModesView /> : null}
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
  showVersionRestore: state.uiInformation.showVersionRestore,
  hasVolume: state.tracing.volume != null,
  hasSkeleton: state.tracing.skeleton != null,
  isDatasetOnScratchVolume: state.dataset.dataStore.isScratch,
});

export default connect(mapStateToProps)(ActionBarView);
