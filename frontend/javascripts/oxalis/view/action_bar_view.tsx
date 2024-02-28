import { createExplorational } from "admin/admin_rest_api";
import { withAuthentication } from "admin/auth/authentication_modal";
import { Alert, Popover } from "antd";
import { AsyncButton } from "components/async_clickables";
import features from "features";
import { ArbitraryVectorInput } from "libs/vector_input";
import { ControlMode, MappingStatusEnum, ViewMode } from "oxalis/constants";
import constants, { ControlModeEnum } from "oxalis/constants";
import {
  doesSupportVolumeWithFallback,
  getColorLayers,
  getMappingInfoForSupportedLayer,
  getUnifiedAdditionalCoordinates,
  getVisibleSegmentationLayer,
  is2dDataset,
} from "oxalis/model/accessors/dataset_accessor";
import { setAdditionalCoordinatesAction } from "oxalis/model/actions/flycam_actions";
import { setAIJobModalStateAction } from "oxalis/model/actions/ui_actions";
import { trackAction } from "oxalis/model/helpers/analytics";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import AddNewLayoutModal from "oxalis/view/action-bar/add_new_layout_modal";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ToolbarView from "oxalis/view/action-bar/toolbar_view";
import TracingActionsView, {
  getLayoutMenu,
  LayoutProps,
} from "oxalis/view/action-bar/tracing_actions_view";
import ViewDatasetActionsView from "oxalis/view/action-bar/view_dataset_actions_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import {
  addNewLayout,
  deleteLayout,
  getLayoutConfig,
  layoutEmitter,
} from "oxalis/view/layouting/layout_persistence";
import * as React from "react";
import { connect, useDispatch, useSelector } from "react-redux";
import type { APIDataset, APIUser } from "types/api_flow_types";
import { type AdditionalCoordinate } from "types/api_flow_types";
import { StartAIJobModal, StartAIJobModalState } from "./action-bar/starting_job_modals";
import ButtonComponent from "./components/button_component";
import { NumberSliderSetting } from "./components/setting_input_views";

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
  aiJobModalState: StartAIJobModalState;
};
type OwnProps = {
  layoutProps: LayoutProps;
};
type Props = OwnProps & StateProps;
type State = {
  isNewLayoutModalOpen: boolean;
};

function AdditionalCoordinatesInputView() {
  const additionalAxes = useSelector((state: OxalisState) =>
    getUnifiedAdditionalCoordinates(state.dataset),
  );
  const additionalCoordinates = useSelector(
    (state: OxalisState) => state.flycam.additionalCoordinates,
  );
  const dispatch = useDispatch();
  const changeAdditionalCoordinates = (values: AdditionalCoordinate[] | null) => {
    if (values != null) {
      dispatch(setAdditionalCoordinatesAction(values));
    }
  };
  const changeAdditionalCoordinatesFromVector = (values: number[]) => {
    if (additionalCoordinates != null) {
      dispatch(
        setAdditionalCoordinatesAction(
          additionalCoordinates.map((el, index) => ({
            ...el,
            value: values[index],
          })),
        ),
      );
    }
  };

  if (additionalCoordinates == null || additionalCoordinates.length === 0) {
    return null;
  }
  return (
    <Popover
      content={
        <div>
          {additionalCoordinates.map((coord, idx) => {
            const { bounds } = additionalAxes[coord.name];
            return (
              <NumberSliderSetting
                label={coord.name}
                key={coord.name}
                min={bounds[0]}
                max={bounds[1] - 1}
                value={coord.value}
                spans={[2, 18, 4]}
                onChange={(newCoord) => {
                  const newCoords = additionalCoordinates.slice();
                  newCoords[idx] = {
                    ...newCoords[idx],
                    value: newCoord,
                  };
                  changeAdditionalCoordinates(newCoords);
                }}
              />
            );
          })}
        </div>
      }
    >
      <ArbitraryVectorInput
        autoSize
        vectorLength={additionalCoordinates.length}
        value={additionalCoordinates.map((el) => el.value)}
        onChange={changeAdditionalCoordinatesFromVector}
        style={{ marginLeft: 10, marginRight: 10 }}
        addonBefore={additionalCoordinates.map((coord) => coord.name).join("")}
      />
    </Popover>
  );
}

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

  renderStartAIJobButton(disabled: boolean): React.ReactNode {
    const tooltipText = disabled
      ? "The dataset needs to have a color layer to start AI processing jobs."
      : "Start a processing job using AI";
    return (
      <ButtonComponent
        key="ai-job-button"
        onClick={() => Store.dispatch(setAIJobModalStateAction("neuron_inferral"))}
        style={{ marginLeft: 12, pointerEvents: "auto" }}
        disabled={disabled}
        title={tooltipText}
        icon={<i className="fas fa-magic" />}
      >
        AI Analysis
      </ButtonComponent>
    );
  }

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
      dataset,
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
    const isAIAnalysisEnabled = () => {
      const activeUser = this.props.activeUser;
      const jobsEnabled = features().jobsEnabled;
      if (isViewMode) {
        return jobsEnabled && activeUser != null && activeUser.isSuperUser;
      }
      return jobsEnabled;
    };

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

    const datasetHasColorLayer = getColorLayers(dataset).length > 0;

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
          <AdditionalCoordinatesInputView />
          {isArbitrarySupported && !is2d ? <ViewModesView /> : null}
          {isAIAnalysisEnabled() ? this.renderStartAIJobButton(!datasetHasColorLayer) : null}
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
        <StartAIJobModal aIJobModalState={this.props.aiJobModalState} />
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
  aiJobModalState: state.uiInformation.aIJobModalState,
});

const connector = connect(mapStateToProps);
export default connector(ActionBarView);
