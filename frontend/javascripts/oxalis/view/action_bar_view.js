// @flow
import { Alert, Dropdown, Icon, Menu } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import type {
  APIDataset,
  APIUser,
  APIMaybeUnimportedDataset,
  TracingType,
} from "admin/api_flow_types";
import { createExplorational } from "admin/admin_rest_api";
import {
  layoutEmitter,
  deleteLayout,
  getLayoutConfig,
  addNewLayout,
} from "oxalis/view/layouting/layout_persistence";
import { trackAction } from "oxalis/model/helpers/analytics";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import AddNewLayoutModal from "oxalis/view/action-bar/add_new_layout_modal";
import ButtonComponent from "oxalis/view/components/button_component";
import Constants, { type ControlMode, ControlModeEnum, type ViewMode } from "oxalis/constants";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import Store, { type OxalisState } from "oxalis/store";
import TracingActionsView, {
  LayoutMenu,
  type LayoutProps,
} from "oxalis/view/action-bar/tracing_actions_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import AuthenticationModal from "admin/auth/authentication_modal";
import { createTracingOverlayMenu } from "dashboard/advanced_dataset/dataset_action_view";

const VersionRestoreWarning = (
  <Alert
    message="Read-only version restore mode active!"
    style={{ padding: "4px 15px" }}
    type="info"
  />
);

type StateProps = {|
  dataset: APIDataset,
  activeUser: ?APIUser,
  viewMode: ViewMode,
  controlMode: ControlMode,
  hasVolume: boolean,
  hasSkeleton: boolean,
  showVersionRestore: boolean,
  isReadOnly: boolean,
|};
type OwnProps = {|
  layoutProps: LayoutProps,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isNewLayoutModalVisible: boolean,
  isAuthenticationModalVisible: boolean,
  useExistingSegmentation: boolean
};

class ActionBarView extends React.PureComponent<Props, State> {
  state = {
    isNewLayoutModalVisible: false,
    isAuthenticationModalVisible: false,
  };

  handleResetLayout = () => {
    Store.dispatch(updateUserSettingAction("layoutScaleValue", 1));
    layoutEmitter.emit(
      "resetLayout",
      this.props.layoutProps.layoutKey,
      this.props.layoutProps.activeLayout,
    );
  };

  handleLayoutDeleted = (layoutName: string) => {
    deleteLayout(this.props.layoutProps.layoutKey, layoutName);
  };

  addNewLayout = (layoutName: string) => {
    this.setState({ isNewLayoutModalVisible: false });
    const configForLayout = getLayoutConfig(
      this.props.layoutProps.layoutKey,
      this.props.layoutProps.activeLayout,
    );
    if (addNewLayout(this.props.layoutProps.layoutKey, layoutName, configForLayout)) {
      this.props.layoutProps.setCurrentLayout(layoutName);
    }
  };

  createTracing = async (
    dataset: APIMaybeUnimportedDataset,
    useExistingSegmentation: boolean,
  ) => {
    const annotation = await createExplorational(dataset, "hybrid", useExistingSegmentation);
    trackAction("Create hybrid tracing (from view mode)");
    location.href = `${location.origin}/annotations/${annotation.typ}/${annotation.id}${
      location.hash
    }`;
  };

  renderStartTracingButton(): React.Node {
    const { activeUser, dataset } = this.props;
    const needsAuthentication = activeUser == null;

    const handleCreateTracing = async ( _dataset: APIMaybeUnimportedDataset,
      _type: TracingType,
      useExistingSegmentation: boolean) => {
      if (needsAuthentication) {
        this.setState({ isAuthenticationModalVisible: true, useExistingSegmentation });
      } else{
        this.createTracing(dataset, useExistingSegmentation);
      }
    };

    return (
      <Dropdown
        overlay={createTracingOverlayMenu(dataset, "hybrid", handleCreateTracing)}
        trigger={["click"]}
      >
        <ButtonComponent style={{ marginLeft: 12 }} type="primary">
          Create Tracing
        </ButtonComponent>
      </Dropdown>
    );
  }

  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const isVolumeSupported = !Constants.MODES_ARBITRARY.includes(this.props.viewMode);
    const isArbitrarySupported =
      this.props.hasSkeleton || this.props.controlMode === ControlModeEnum.VIEW;
    const layoutMenu = (
      <LayoutMenu
        {...this.props.layoutProps}
        addNewLayout={() => {
          this.setState({ isNewLayoutModalVisible: true });
        }}
        onResetLayout={this.handleResetLayout}
        onSelectLayout={this.props.layoutProps.setCurrentLayout}
        onDeleteLayout={this.handleLayoutDeleted}
      />
    );

    const viewDropdown = (
      <div style={{ marginLeft: 10 }}>
        <Dropdown overlay={<Menu>{layoutMenu}</Menu>} trigger={["click"]}>
          <ButtonComponent style={{ padding: "0 10px" }}>
            <Icon type="down" />
          </ButtonComponent>
        </Dropdown>
      </div>
    );

    return (
      <React.Fragment>
        <div className="action-bar">
          {isTraceMode && !this.props.showVersionRestore ? (
            <TracingActionsView layoutMenu={layoutMenu} />
          ) : (
            viewDropdown
          )}
          {this.props.showVersionRestore ? VersionRestoreWarning : null}
          <DatasetPositionView />
          {!this.props.isReadOnly && this.props.hasVolume && isVolumeSupported ? (
            <VolumeActionsView />
          ) : null}
          {isArbitrarySupported ? <ViewModesView /> : null}
          {isTraceMode ? null : this.renderStartTracingButton()}
        </div>
        <AddNewLayoutModal
          addLayout={this.addNewLayout}
          visible={this.state.isNewLayoutModalVisible}
          onCancel={() => this.setState({ isNewLayoutModalVisible: false })}
        />
        <AuthenticationModal
          onLoggedIn={() => {
            this.setState({ isAuthenticationModalVisible: false });
            this.createTracing(this.props.dataset, this.state.useExistingSegmentation);
          }}
          onCancel={() => this.setState({ isAuthenticationModalVisible: false })}
          visible={this.state.isAuthenticationModalVisible}
        />
      </React.Fragment>
    );
  }
}
const mapStateToProps = (state: OxalisState): StateProps => ({
  dataset: state.dataset,
  activeUser: state.activeUser,
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  showVersionRestore: state.uiInformation.showVersionRestore,
  hasVolume: state.tracing.volume != null,
  hasSkeleton: state.tracing.skeleton != null,
  isReadOnly: !state.tracing.restrictions.allowUpdate,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(ActionBarView);
