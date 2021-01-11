// @flow
import { Alert } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";

import type {
  APIDataset,
  APIUser,
  APIMaybeUnimportedDataset,
  TracingType,
} from "types/api_flow_types";
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
import AuthenticationModal from "admin/auth/authentication_modal";
import ButtonComponent from "oxalis/view/components/button_component";
import Constants, { type ControlMode, ControlModeEnum, type ViewMode } from "oxalis/constants";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import Store, { type OxalisState } from "oxalis/store";
import TracingActionsView, {
  LayoutMenu,
  type LayoutProps,
} from "oxalis/view/action-bar/tracing_actions_view";
import ViewDatasetActionsView from "oxalis/view/action-bar/view_dataset_actions_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import {
  is2dDataset,
  doesSupportVolumeWithFallback,
} from "oxalis/model/accessors/dataset_accessor";

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
  hasVolumeFallback: boolean,
  hasSkeleton: boolean,
  showVersionRestore: boolean,
  isReadOnly: boolean,
  is2d: boolean,
|};
type OwnProps = {|
  layoutProps: LayoutProps,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isNewLayoutModalVisible: boolean,
  isAuthenticationModalVisible: boolean,
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

  createTracing = async (dataset: APIMaybeUnimportedDataset) => {
    // If the dataset supports creating an annotation with a fallback segmentation,
    // use it (as the fallback can always be removed later)
    const withFallback = doesSupportVolumeWithFallback(dataset);

    const annotation = await createExplorational(dataset, "hybrid", withFallback);
    trackAction("Create hybrid tracing (from view mode)");
    location.href = `${location.origin}/annotations/${annotation.typ}/${annotation.id}${
      location.hash
    }`;
  };

  renderStartTracingButton(): React.Node {
    const { activeUser, dataset } = this.props;
    const needsAuthentication = activeUser == null;

    const handleCreateTracing = async (_dataset: APIMaybeUnimportedDataset, _type: TracingType) => {
      if (needsAuthentication) {
        this.setState({ isAuthenticationModalVisible: true });
      } else {
        this.createTracing(dataset);
      }
    };

    return (
      <ButtonComponent
        style={{ marginLeft: 12 }}
        type="primary"
        onClick={() => handleCreateTracing(dataset, "hybrid")}
      >
        Create Annotation
      </ButtonComponent>
    );
  }

  render() {
    const {
      hasVolume,
      hasVolumeFallback,
      isReadOnly,
      dataset,
      showVersionRestore,
      controlMode,
      viewMode,
      hasSkeleton,
      layoutProps,
    } = this.props;
    const isTraceMode = controlMode === ControlModeEnum.TRACE;
    const isVolumeSupported = !Constants.MODES_ARBITRARY.includes(viewMode);
    const isArbitrarySupported = hasSkeleton || controlMode === ControlModeEnum.VIEW;
    const layoutMenu = (
      <LayoutMenu
        {...layoutProps}
        key="layout-menu"
        addNewLayout={() => {
          this.setState({ isNewLayoutModalVisible: true });
        }}
        onResetLayout={this.handleResetLayout}
        onSelectLayout={layoutProps.setCurrentLayout}
        onDeleteLayout={this.handleLayoutDeleted}
      />
    );

    return (
      <React.Fragment>
        <div className="action-bar">
          {isTraceMode && !showVersionRestore ? (
            <TracingActionsView layoutMenu={layoutMenu} hasVolumeFallback={hasVolumeFallback} />
          ) : (
            <ViewDatasetActionsView layoutMenu={layoutMenu} />
          )}
          {showVersionRestore ? VersionRestoreWarning : null}
          <DatasetPositionView />
          {!isReadOnly && hasVolume && isVolumeSupported ? <VolumeActionsView /> : null}
          {isArbitrarySupported && !this.props.is2d ? <ViewModesView /> : null}
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
            this.createTracing(dataset);
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
  hasVolumeFallback: state.tracing.volume != null && state.tracing.volume.fallbackLayer != null,
  hasSkeleton: state.tracing.skeleton != null,
  isReadOnly: !state.tracing.restrictions.allowUpdate,
  is2d: is2dDataset(state.dataset),
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(ActionBarView);
