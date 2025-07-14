import { withAuthentication } from "admin/auth/authentication_modal";
import { createExplorational } from "admin/rest_api";
import { Alert, Modal, Popover, Space } from "antd";
import { AsyncButton, type AsyncButtonProps } from "components/async_clickables";
import { NewVolumeLayerSelection } from "dashboard/advanced_dataset/create_explorative_modal";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrTeamManager } from "libs/utils";
import { ArbitraryVectorInput } from "libs/vector_input";
import * as React from "react";
import { connect, useDispatch } from "react-redux";
import { useHistory } from "react-router-dom";
import type { APIDataset, APISegmentationLayer, APIUser } from "types/api_types";
import { APIJobType, type AdditionalCoordinate } from "types/api_types";
import { type ControlMode, MappingStatusEnum, type ViewMode } from "viewer/constants";
import constants, { ControlModeEnum } from "viewer/constants";
import {
  doesSupportVolumeWithFallback,
  getColorLayers,
  getMappingInfoForSupportedLayer,
  getSegmentationLayers,
  getUnifiedAdditionalCoordinates,
  getVisibleSegmentationLayers,
  is2dDataset,
} from "viewer/model/accessors/dataset_accessor";
import { setAdditionalCoordinatesAction } from "viewer/model/actions/flycam_actions";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import type { WebknossosState } from "viewer/store";
import Store from "viewer/store";
import AddNewLayoutModal from "viewer/view/action-bar/add_new_layout_modal";
import DatasetPositionView from "viewer/view/action-bar/dataset_position_view";
import ToolbarView from "viewer/view/action-bar/tools/toolbar_view";
import TracingActionsView, {
  getLayoutMenu,
  type LayoutProps,
} from "viewer/view/action-bar/tracing_actions_view";
import ViewDatasetActionsView from "viewer/view/action-bar/view_dataset_actions_view";
import ViewModesView from "viewer/view/action-bar/view_modes_view";
import {
  addNewLayout,
  deleteLayout,
  getLayoutConfig,
  layoutEmitter,
} from "viewer/view/layouting/layout_persistence";
import { StartAIJobModal, type StartAIJobModalState } from "./action-bar/starting_job_modals";
import ToolkitView from "./action-bar/tools/toolkit_switcher_view";
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
  showVersionRestore: boolean;
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
  const additionalAxes = useWkSelector((state) => getUnifiedAdditionalCoordinates(state.dataset));
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
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
  const activeUser = useWkSelector((state) => state.activeUser);
  const visibleSegmentationLayers = useWkSelector((state) => getVisibleSegmentationLayers(state));
  const segmentationLayers = useWkSelector((state) => getSegmentationLayers(state.dataset));
  const dataset = useWkSelector((state) => state.dataset);
  const [isLayerSelectionModalVisible, setLayerSelectionModalVisible] =
    React.useState<boolean>(false);
  const [selectedLayerName, setSelectedLayerName] = React.useState<string | undefined>(undefined);

  const getUnambiguousSegmentationLayer = () => {
    if (visibleSegmentationLayers?.length === 1) return visibleSegmentationLayers[0];
    if (segmentationLayers.length === 1) return segmentationLayers[0];
    return null;
  };

  const continueWithLayer = async (layer: APISegmentationLayer | null | undefined) => {
    // If the dataset supports creating an annotation with a fallback segmentation,
    // use it (as the fallback can always be removed later)
    const fallbackLayerName = getFallbackLayerName(layer);
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

  const getFallbackLayerName = (segmentationLayer: APISegmentationLayer | null | undefined) => {
    return segmentationLayer && doesSupportVolumeWithFallback(dataset, segmentationLayer)
      ? segmentationLayer.name
      : null;
  };

  const onClick = async () => {
    // This will be set in cases where it is clear which layer to use.
    const unambiguousSegmentationLayer = getUnambiguousSegmentationLayer();
    if (unambiguousSegmentationLayer == null && segmentationLayers.length > 1) {
      setLayerSelectionModalVisible(true);
      return;
    }
    await continueWithLayer(unambiguousSegmentationLayer);
  };

  const handleLayerSelected = async () => {
    setLayerSelectionModalVisible(false);
    const selectedLayer = selectedLayerName
      ? segmentationLayers.find((layer) => layer.name === selectedLayerName)
      : null;
    await continueWithLayer(selectedLayer);
  };

  const ButtonWithAuthentication = withAuthentication<AsyncButtonProps, typeof AsyncButton>(
    AsyncButton,
  );
  return (
    <>
      <ButtonWithAuthentication
        activeUser={activeUser}
        authenticationMessage="You have to register or login to create an annotation."
        style={{
          marginLeft: 12,
        }}
        type="primary"
        onClick={onClick}
      >
        Create Annotation
      </ButtonWithAuthentication>

      <Modal
        open={isLayerSelectionModalVisible}
        onCancel={() => setLayerSelectionModalVisible(false)}
        onOk={handleLayerSelected}
      >
        <NewVolumeLayerSelection
          segmentationLayers={segmentationLayers}
          dataset={dataset}
          selectedSegmentationLayerName={selectedLayerName}
          setSelectedSegmentationLayerName={setSelectedLayerName}
        />
      </Modal>
    </>
  );
}

function ModesView() {
  const hasSkeleton = useWkSelector((state) => state.annotation.skeleton != null);
  const is2d = useWkSelector((state) => is2dDataset(state.dataset));
  const controlMode = useWkSelector((state) => state.temporaryConfiguration.controlMode);
  const isViewMode = controlMode === ControlModeEnum.VIEW;
  const isReadOnly = useWkSelector((state) => !state.annotation.restrictions.allowUpdate);
  const isOrthoMode = useWkSelector(
    (state) => state.temporaryConfiguration.viewMode === "orthogonal",
  );

  const isArbitrarySupported = hasSkeleton || isViewMode;

  // The outer div is necessary for proper spacing.
  return (
    <div>
      <Space.Compact>
        {isArbitrarySupported && !is2d ? <ViewModesView /> : null}
        {isViewMode || isReadOnly || !isOrthoMode ? null : <ToolkitView />}
      </Space.Compact>
    </div>
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
    const { dataset, is2d, showVersionRestore, controlMode, layoutProps, viewMode, activeUser } =
      this.props;
    const isAdminOrDatasetManager = activeUser && isUserAdminOrTeamManager(activeUser);
    const isViewMode = controlMode === ControlModeEnum.VIEW;
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
          <ModesView />
          {getIsAIAnalysisEnabled() && isAdminOrDatasetManager
            ? this.renderStartAIJobButton(shouldDisableAIJobButton, tooltip)
            : null}
          {isViewMode ? this.renderStartTracingButton() : null}
          {constants.MODES_PLANE.indexOf(viewMode) > -1 ? <ToolbarView /> : null}
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

const mapStateToProps = (state: WebknossosState): StateProps => ({
  dataset: state.dataset,
  activeUser: state.activeUser,
  controlMode: state.temporaryConfiguration.controlMode,
  showVersionRestore: state.uiInformation.showVersionRestore,
  is2d: is2dDataset(state.dataset),
  viewMode: state.temporaryConfiguration.viewMode,
  aiJobModalState: state.uiInformation.aIJobModalState,
});

const connector = connect(mapStateToProps);
export default connector(ActionBarView);
