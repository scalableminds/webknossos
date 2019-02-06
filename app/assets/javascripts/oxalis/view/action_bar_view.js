// @flow
import { Alert, Dropdown, Icon, Menu, Tooltip } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import type { APIDataset, APIUser } from "admin/api_flow_types";
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
import Constants, { type ControlMode, ControlModeEnum, type Mode } from "oxalis/constants";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import Store, { type OxalisState } from "oxalis/store";
import TracingActionsView, {
  LayoutMenu,
  type LayoutProps,
} from "oxalis/view/action-bar/tracing_actions_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import renderIndependently from "libs/render_independently";
import RegistrationModal from "admin/auth/registration_modal";

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
  viewMode: Mode,
  controlMode: ControlMode,
  hasVolume: boolean,
  hasSkeleton: boolean,
  showVersionRestore: boolean,
|};
type OwnProps = {|
  layoutProps: LayoutProps,
|};
type Props = {| ...OwnProps, ...StateProps |};

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

  renderStartTracingButton(): React.Node {
    const needsAuthentication = this.props.activeUser == null;

    const createTracing = async () => {
      if (needsAuthentication) {
        let hasRegistered = false;
        await renderIndependently(destroy => (
          <RegistrationModal
            onOk={() => {
              hasRegistered = true;
            }}
            destroy={destroy}
          />
        ));
        if (!hasRegistered) return;
      }
      const type = "hybrid";
      const annotation = await createExplorational(this.props.dataset, type, true);
      trackAction(`Create ${type} tracing (from view mode)`);
      location.href = `${location.origin}/annotations/${annotation.typ}/${annotation.id}${
        location.hash
      }`;
    };

    return (
      <ButtonComponent onClick={createTracing} style={{ marginLeft: 12 }} type="primary">
        Create Tracing
      </ButtonComponent>
    );
  }

  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const isVolumeSupported = !Constants.MODES_ARBITRARY.includes(this.props.viewMode);
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

    const readonlyDropdown = (
      <Dropdown overlay={<Menu>{layoutMenu}</Menu>}>
        <ButtonComponent>
          <Icon type="down" />
        </ButtonComponent>
      </Dropdown>
    );

    return (
      <React.Fragment>
        <div className="action-bar">
          {isTraceMode && !this.props.showVersionRestore ? (
            <TracingActionsView layoutMenu={layoutMenu} />
          ) : (
            readonlyDropdown
          )}
          {this.props.showVersionRestore ? VersionRestoreWarning : null}
          <DatasetPositionView />
          {this.props.hasVolume && isVolumeSupported ? <VolumeActionsView /> : null}
          {this.props.hasSkeleton && isTraceMode ? <ViewModesView /> : null}
          {isTraceMode ? null : this.renderStartTracingButton()}
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
  dataset: state.dataset,
  activeUser: state.activeUser,
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  showVersionRestore: state.uiInformation.showVersionRestore,
  hasVolume: state.tracing.volume != null,
  hasSkeleton: state.tracing.skeleton != null,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(ActionBarView);
