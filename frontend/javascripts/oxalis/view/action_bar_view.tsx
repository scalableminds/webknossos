import { createExplorational } from "admin/admin_rest_api";
import { withAuthentication } from "admin/auth/authentication_modal";
import { Alert, Popover } from "antd";
import { AsyncButton, type AsyncButtonProps } from "components/async_clickables";
import { isUserAdminOrTeamManager } from "libs/utils";
import { ArbitraryVectorInput } from "libs/vector_input";
import { type ControlMode, MappingStatusEnum, type ViewMode } from "oxalis/constants";
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
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import AddNewLayoutModal from "oxalis/view/action-bar/add_new_layout_modal";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ToolbarView from "oxalis/view/action-bar/toolbar_view";
import TracingActionsView, {
  getLayoutMenu,
  type LayoutProps,
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
import { useHistory } from "react-router-dom";
import type { APIDataset, APIUser } from "types/api_flow_types";
import { APIJobType, type AdditionalCoordinate } from "types/api_flow_types";
import { StartAIJobModal, type StartAIJobModalState } from "./action-bar/starting_job_modals";
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
                wheelFactor={0.05}
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

function CreateAnnotationButton() {
  const history = useHistory();
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);

  const onClick = async (dataset: APIDataset) => {
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
      dataset.id,
      "hybrid",
      false,
      fallbackLayerName,
      maybeMappingName,
    );
    history.push(`/annotations/${annotation.id}${location.hash}`);
  };

  const ButtonWithAuthentication = withAuthentication<AsyncButtonProps, typeof AsyncButton>(
    AsyncButton,
  );
  return (
    <ButtonWithAuthentication
      activeUser={activeUser}
      authenticationMessage="You have to register or login to create an annotation."
      style={{
        marginLeft: 12,
      }}
      type="primary"
      onClick={() => onClick(dataset)}
    >
      Create Annotation
    </ButtonWithAuthentication>
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

  renderStartAIJobButton(disabled: boolean, tooltipTextIfDisabled: string): React.ReactNode {
    const tooltipText = disabled ? tooltipTextIfDisabled : "Start a processing job using AI";
    return (
      <ButtonComponent
        key="ai-job-button"
        onClick={() => Store.dispatch(setAIJobModalStateAction(APIJobType.INFER_NEURONS))}
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
    return <CreateAnnotationButton />;
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
      activeUser,
    } = this.props;
    const isAdminOrDatasetManager = activeUser && isUserAdminOrTeamManager(activeUser);
    const isViewMode = controlMode === ControlModeEnum.VIEW;
    const isArbitrarySupported = hasSkeleton || isViewMode;
    const getIsAIAnalysisEnabled = () => {
      const jobsEnabled =
        dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.INFER_NEURONS) ||
        dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.INFER_MITOCHONDRIA) ||
        dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.INFER_NUCLEI) ||
        dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.ALIGN_SECTIONS);
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

    const colorLayers = getColorLayers(dataset);
    const datasetHasNoColorLayer = colorLayers.length === 0;
    const isNd = (colorLayers[0]?.additionalAxes ?? []).length > 0;
    const is2DOrNDDataset = isNd || is2d;
    const isAIAnalysisDisabled = !getIsAIAnalysisEnabled();
    const shouldDisableAIJobButton =
      isAIAnalysisDisabled || datasetHasNoColorLayer || is2DOrNDDataset;
    let tooltip = "AI analysis is not enabled for this dataset.";
    if (datasetHasNoColorLayer) {
      tooltip = "The dataset needs to have a color layer to start AI processing jobs.";
    } else if (is2DOrNDDataset) {
      tooltip = `AI Analysis is not supported for ${is2d ? "2D" : "ND"} datasets.`;
    }

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
          {getIsAIAnalysisEnabled() && isAdminOrDatasetManager
            ? this.renderStartAIJobButton(shouldDisableAIJobButton, tooltip)
            : null}
          {isViewMode ? this.renderStartTracingButton() : null}
          {constants.MODES_PLANE.indexOf(viewMode) > -1 ? (
            <ToolbarView isReadOnly={isReadOnly} />
          ) : null}
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
  hasSkeleton: state.annotation.skeleton != null,
  isReadOnly: !state.annotation.restrictions.allowUpdate,
  is2d: is2dDataset(state.dataset),
  viewMode: state.temporaryConfiguration.viewMode,
  aiJobModalState: state.uiInformation.aIJobModalState,
});

const connector = connect(mapStateToProps);
export default connector(ActionBarView);
