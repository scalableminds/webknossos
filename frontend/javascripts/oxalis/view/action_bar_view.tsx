import { Alert } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import type { APIDataset, APIUser } from "types/api_flow_types";
import { createExplorational } from "admin/admin_rest_api";
import {
  layoutEmitter,
  deleteLayout,
  getLayoutConfig,
  addNewLayout,
} from "oxalis/view/layouting/layout_persistence";
import { trackAction } from "oxalis/model/helpers/analytics";
import AddNewLayoutModal from "oxalis/view/action-bar/add_new_layout_modal";
import { withAuthentication } from "admin/auth/authentication_modal";
import { ViewMode, ControlMode, MappingStatusEnum } from "oxalis/constants";
import constants, { ControlModeEnum } from "oxalis/constants";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import TracingActionsView, {
  getLayoutMenu,
  LayoutProps,
} from "oxalis/view/action-bar/tracing_actions_view";
import ViewDatasetActionsView from "oxalis/view/action-bar/view_dataset_actions_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import ToolbarView from "oxalis/view/action-bar/toolbar_view";
import {
  is2dDataset,
  doesSupportVolumeWithFallback,
  getVisibleSegmentationLayer,
  getMappingInfoForSupportedLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { AsyncButton } from "components/async_clickables";

const VersionRestoreWarning = (
  <Alert
    message="Read-only version restore mode active!"
    style={{
      padding: "4px 15px",
    }}
    type="info"
  />
);
type StateProps = {
  dataset: APIDataset;
  activeUser: APIUser | null | undefined;
  controlMode: ControlMode;
  hasSkeleton: boolean;
  showVersionRestore: boolean;
  isReadOnly: boolean;
  is2d: boolean;
  viewMode: ViewMode;
};
type OwnProps = {
  layoutProps: LayoutProps;
};
type Props = OwnProps & StateProps;
type State = {
  isNewLayoutModalOpen: boolean;
};

class ActionBarView extends React.PureComponent<Props, State> {
  state: State = {
    isNewLayoutModalOpen: false,
  };

  handleResetLayout = () => {
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
    this.setState({
      isNewLayoutModalOpen: false,
    });
    const configForLayout = getLayoutConfig(
      this.props.layoutProps.layoutKey,
      this.props.layoutProps.activeLayout,
    );

    if (addNewLayout(this.props.layoutProps.layoutKey, layoutName, configForLayout)) {
      this.props.layoutProps.setCurrentLayout(layoutName);
    }
  };

  createAnnotation = async (dataset: APIDataset) => {
    // If the dataset supports creating an annotation with a fallback segmentation,
    // use it (as the fallback can always be removed later)
    const maybeSegmentationLayer = getVisibleSegmentationLayer(Store.getState());
    const fallbackLayerName =
      maybeSegmentationLayer && doesSupportVolumeWithFallback(dataset, maybeSegmentationLayer)
        ? maybeSegmentationLayer.name
        : null;

    const mappingInfo = getMappingInfoForSupportedLayer(Store.getState());
    let maybeMappingName = null;
    if (
      mappingInfo.mappingStatus !== MappingStatusEnum.DISABLED &&
      mappingInfo.mappingType === "HDF5"
    ) {
      maybeMappingName = mappingInfo.mappingName;
    }

    const annotation = await createExplorational(
      dataset,
      "hybrid",
      false,
      fallbackLayerName,
      maybeMappingName,
    );
    trackAction("Create hybrid tracing (from view mode)");
    location.href = `${location.origin}/annotations/${annotation.typ}/${annotation.id}${location.hash}`;
  };

  renderStartTracingButton(): React.ReactNode {
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(props: AsyncButtonProps) => Ele... Remove this comment to see the full error message
    const ButtonWithAuthentication = withAuthentication(AsyncButton);
    return (
      <ButtonWithAuthentication
        activeUser={this.props.activeUser}
        authenticationMessage="You have to register or login to create an annotation."
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: string; activeUser: APIUser | nu... Remove this comment to see the full error message
        style={{
          marginLeft: 12,
        }}
        type="primary"
        onClick={() => this.createAnnotation(this.props.dataset)}
      >
        Create Annotation
      </ButtonWithAuthentication>
    );
  }

  render() {
    const {
      is2d,
      isReadOnly,
      showVersionRestore,
      controlMode,
      hasSkeleton,
      layoutProps,
      viewMode,
    } = this.props;
    const isViewMode = controlMode === ControlModeEnum.VIEW;
    const isArbitrarySupported = hasSkeleton || isViewMode;

    const layoutMenu = getLayoutMenu({
      ...layoutProps,
      addNewLayout: () => {
        this.setState({
          isNewLayoutModalOpen: true,
        });
      },
      onResetLayout: this.handleResetLayout,
      onSelectLayout: layoutProps.setCurrentLayout,
      onDeleteLayout: this.handleLayoutDeleted,
    });

    return (
      <React.Fragment>
        <div className="action-bar">
          {isViewMode || showVersionRestore ? (
            <ViewDatasetActionsView layoutMenu={layoutMenu} />
          ) : (
            <TracingActionsView layoutMenu={layoutMenu} />
          )}
          {showVersionRestore ? VersionRestoreWarning : null}
          <DatasetPositionView />
          {isArbitrarySupported && !is2d ? <ViewModesView /> : null}
          {!isReadOnly && constants.MODES_PLANE.indexOf(viewMode) > -1 ? <ToolbarView /> : null}
          {isViewMode ? this.renderStartTracingButton() : null}
        </div>
        <AddNewLayoutModal
          addLayout={this.addNewLayout}
          isOpen={this.state.isNewLayoutModalOpen}
          onCancel={() =>
            this.setState({
              isNewLayoutModalOpen: false,
            })
          }
        />
      </React.Fragment>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  dataset: state.dataset,
  activeUser: state.activeUser,
  controlMode: state.temporaryConfiguration.controlMode,
  showVersionRestore: state.uiInformation.showVersionRestore,
  hasSkeleton: state.tracing.skeleton != null,
  isReadOnly: !state.tracing.restrictions.allowUpdate,
  is2d: is2dDataset(state.dataset),
  viewMode: state.temporaryConfiguration.viewMode,
});

const connector = connect(mapStateToProps);
export default connector(ActionBarView);
