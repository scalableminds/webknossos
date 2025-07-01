import { withAuthentication } from "admin/auth/authentication_modal";
import { createExplorational } from "admin/rest_api";
import { Alert, Modal, Popover, Space } from "antd";
import { AsyncButton, type AsyncButtonProps } from "components/async_clickables";
import { NewVolumeLayerSelection } from "dashboard/advanced_dataset/create_explorative_modal";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrTeamManager } from "libs/utils";
import { ArbitraryVectorInput } from "libs/vector_input";
import * as React from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import type { APISegmentationLayer } from "types/api_types";
import { APIJobType, type AdditionalCoordinate } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
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
import { StartAIJobModal } from "./action-bar/starting_job_modals";
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

type Props = {
  layoutProps: LayoutProps;
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
  const navigate = useNavigate();
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
    navigate(`/annotations/${annotation.id}${location.hash}`);
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

function ActionBarView(props: Props) {
  const { layoutProps } = props;
  const dataset = useWkSelector((state: WebknossosState) => state.dataset);
  const activeUser = useWkSelector((state: WebknossosState) => state.activeUser);
  const controlMode = useWkSelector(
    (state: WebknossosState) => state.temporaryConfiguration.controlMode,
  );
  const showVersionRestore = useWkSelector(
    (state: WebknossosState) => state.uiInformation.showVersionRestore,
  );
  const is2d = useWkSelector((state: WebknossosState) => is2dDataset(state.dataset));
  const viewMode = useWkSelector((state: WebknossosState) => state.temporaryConfiguration.viewMode);
  const aiJobModalState = useWkSelector(
    (state: WebknossosState) => state.uiInformation.aIJobModalState,
  );

  const [isNewLayoutModalOpen, setIsNewLayoutModalOpen] = React.useState(false);

  const handleResetLayout = () => {
    layoutEmitter.emit("resetLayout", layoutProps.layoutKey, layoutProps.activeLayout);
  };

  const handleLayoutDeleted = (layoutName: string) => {
    deleteLayout(layoutProps.layoutKey, layoutName);
  };

  const handleAddNewLayout = (layoutName: string) => {
    setIsNewLayoutModalOpen(false);
    const configForLayout = getLayoutConfig(layoutProps.layoutKey, layoutProps.activeLayout);

    if (addNewLayout(layoutProps.layoutKey, layoutName, configForLayout)) {
      layoutProps.setCurrentLayout(layoutName);
    }
  };

  const renderStartAIJobButton = (
    disabled: boolean,
    tooltipTextIfDisabled: string,
  ): React.ReactNode => {
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
  };

  const renderStartTracingButton = (): React.ReactNode => {
    return <CreateAnnotationButton />;
  };

  const isAdminOrDatasetManager = activeUser && isUserAdminOrTeamManager(activeUser);
  const isViewMode = controlMode === ControlModeEnum.VIEW;
  const getIsAIAnalysisEnabled = () => {
    const jobsEnabled =
      dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.INFER_NEURONS) ||
      dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.INFER_MITOCHONDRIA) ||
      dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.ALIGN_SECTIONS);
    return jobsEnabled;
  };

  const layoutMenu = getLayoutMenu({
    ...layoutProps,
    addNewLayout: () => {
      setIsNewLayoutModalOpen(true);
    },
    onResetLayout: handleResetLayout,
    onSelectLayout: layoutProps.setCurrentLayout,
    onDeleteLayout: handleLayoutDeleted,
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
          ? renderStartAIJobButton(shouldDisableAIJobButton, tooltip)
          : null}
        {isViewMode ? renderStartTracingButton() : null}
        {constants.MODES_PLANE.indexOf(viewMode) > -1 ? <ToolbarView /> : null}
      </div>
      <AddNewLayoutModal
        addLayout={handleAddNewLayout}
        isOpen={isNewLayoutModalOpen}
        onCancel={() => setIsNewLayoutModalOpen(false)}
      />
      <StartAIJobModal aIJobModalState={aiJobModalState} />
    </React.Fragment>
  );
}

export default ActionBarView;
