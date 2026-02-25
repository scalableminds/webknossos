import { InfoCircleOutlined, PlusOutlined, SaveOutlined, WarningOutlined } from "@ant-design/icons";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { clearCache, updateDatasetDefaultConfiguration } from "admin/rest_api";
import { Button, Divider, Modal, Row } from "antd";
import FastTooltip from "components/fast_tooltip";
import update from "immutability-helper";
import ErrorHandling from "libs/error_handling";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { isUserAdminOrDatasetManager } from "libs/utils";
import partial from "lodash-es/partial";
import { type RecommendedConfiguration, settings, settingsTooltips } from "messages";
import React from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import { APIAnnotationTypeEnum, type APIDataLayer } from "types/api_types";
import type { ValueOf } from "types/globals";
import { getSpecificDefaultsForLayer } from "types/schemas/dataset_view_configuration_defaults";
import { ControlModeEnum, MappingStatusEnum } from "viewer/constants";
import {
  getDefaultValueRangeOfLayer,
  getElementClass,
  isColorLayer as getIsColorLayer,
} from "viewer/model/accessors/dataset_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { pushSaveQueueTransactionIsolated } from "viewer/model/actions/save_actions";
import {
  reloadHistogramAction,
  updateDatasetSettingAction,
  updateLayerSettingAction,
} from "viewer/model/actions/settings_actions";
import { addLayerToAnnotation } from "viewer/model/sagas/volume/update_actions";
import { Model } from "viewer/singletons";
import type {
  DatasetConfiguration,
  DatasetLayerConfiguration,
  WebknossosState,
} from "viewer/store";
import Store from "viewer/store";
import { MaterializeVolumeAnnotationModal } from "viewer/view/action_bar/materialize_volume_annotation_modal";
import { NumberSliderSetting } from "viewer/view/components/setting_input_views";
import ColorLayerSettings from "./components/color_layer_settings";
import LayerSettingsHeader from "./components/layer_settings_header";
import SegmentationLayerSettings from "./components/segmentation_layer_settings";
import SkeletonLayerSettings from "./components/skeleton_layer_settings";
import Histogram, { isHistogramSupported } from "./histogram_view";
import AddVolumeLayerModal from "./modals/add_volume_layer_modal";

type DatasetSettingsProps = ReturnType<typeof mapStateToProps> &
  ReturnType<typeof mapDispatchToProps>;

type State = {
  isAddVolumeLayerModalVisible: boolean;
  preselectedSegmentationLayerName: string | undefined;
  segmentationLayerWasPreselected: boolean | undefined;
  layerToMergeWithFallback: APIDataLayer | null | undefined;
};

class DatasetSettings extends React.PureComponent<DatasetSettingsProps, State> {
  state: State = {
    isAddVolumeLayerModalVisible: false,
    preselectedSegmentationLayerName: undefined,
    segmentationLayerWasPreselected: false,
    layerToMergeWithFallback: null,
  };

  getHistogram = (layerName: string, layer: DatasetLayerConfiguration) => {
    const { intensityRange, min, max, isInEditMode } = layer;
    if (!intensityRange) {
      return null;
    }
    const defaultIntensityRange = getDefaultValueRangeOfLayer(this.props.dataset, layerName);
    const histograms = this.props.histogramData?.[layerName];
    const elementClass = getElementClass(this.props.dataset, layerName);

    return (
      <Histogram
        supportFractions={elementClass === "float" || elementClass === "double"}
        data={histograms}
        intensityRangeMin={intensityRange[0]}
        intensityRangeMax={intensityRange[1]}
        min={min}
        max={max}
        isInEditMode={isInEditMode}
        layerName={layerName}
        defaultMinMax={defaultIntensityRange}
        reloadHistogram={() => this.reloadHistogram(layerName)}
      />
    );
  };

  reloadHistogram = async (layerName: string): Promise<void> => {
    await clearCache(this.props.dataset, layerName);
    this.props.reloadHistogram(layerName);
  };

  LayerSettings = ({
    layerName,
    layerConfiguration,
    isColorLayer,
    isLastLayer,
    hasLessThanTwoColorLayers = true,
  }: {
    layerName: string;
    layerConfiguration: DatasetLayerConfiguration | null | undefined;
    isColorLayer: boolean;
    isLastLayer: boolean;
    hasLessThanTwoColorLayers?: boolean;
  }) => {
    const { setNodeRef, transform, transition, isDragging } = useSortable({ id: layerName });

    // Ensure that every layer needs a layer configuration and that color layers have a color layer.
    if (!layerConfiguration || (isColorLayer && !layerConfiguration.color)) {
      return null;
    }
    const elementClass = getElementClass(this.props.dataset, layerName);
    const { isDisabled, isInEditMode } = layerConfiguration;
    const betweenLayersMarginBottom = isLastLayer ? {} : { marginBottom: 30 };

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? "100" : "auto",
      opacity: isDragging ? 0.3 : 1,
      marginBottom: isLastLayer ? 30 : 0,
    };

    const opacityLabel =
      layerConfiguration.alpha === 0 ? (
        <FastTooltip title="The current opacity is zero">
          Opacity <WarningOutlined style={{ color: "orange" }} />
        </FastTooltip>
      ) : (
        "Opacity"
      );

    const isHistogramAvailable = isHistogramSupported(elementClass) && isColorLayer;
    const layerSpecificDefaults = getSpecificDefaultsForLayer(
      this.props.dataset,
      layerName,
      isColorLayer,
    );

    return (
      <div key={layerName} style={style} ref={setNodeRef}>
        <LayerSettingsHeader
          layerName={layerName}
          layerSettings={layerConfiguration}
          isColorLayer={isColorLayer}
          isDisabled={isDisabled}
          isInEditMode={isInEditMode}
          isHistogramAvailable={isHistogramAvailable}
          hasLessThanTwoColorLayers={hasLessThanTwoColorLayers}
          onShowAddVolumeLayerModal={(preselectedLayerName) => {
            this.setState({
              isAddVolumeLayerModalVisible: true,
              segmentationLayerWasPreselected: true,
              preselectedSegmentationLayerName: preselectedLayerName,
            });
          }}
          onSetLayerToMergeWithFallback={(layer) =>
            this.setState({ layerToMergeWithFallback: layer })
          }
        />
        {isDisabled ? null : (
          <div
            style={{
              ...betweenLayersMarginBottom,
              marginLeft: 10,
            }}
          >
            {isHistogramAvailable && this.getHistogram(layerName, layerConfiguration)}
            <NumberSliderSetting
              label={opacityLabel}
              min={0}
              max={100}
              value={layerConfiguration.alpha}
              onChange={partial(this.props.onChangeLayer, layerName, "alpha")}
              defaultValue={layerSpecificDefaults.alpha}
            />
            {isColorLayer ? (
              <ColorLayerSettings layerName={layerName} layerConfiguration={layerConfiguration} />
            ) : (
              <SegmentationLayerSettings layerName={layerName} />
            )}
          </div>
        )}
      </div>
    );
  };

  showAddVolumeLayerModal = () => {
    this.setState({
      isAddVolumeLayerModalVisible: true,
    });
  };

  hideAddVolumeLayerModal = () => {
    this.setState({
      isAddVolumeLayerModalVisible: false,
      segmentationLayerWasPreselected: false,
      preselectedSegmentationLayerName: undefined,
    });
  };

  addSkeletonAnnotationLayer = async () => {
    this.props.addSkeletonLayerToAnnotation();
    await Model.ensureSavedState();
    location.reload();
  };

  saveViewConfigurationAsDefault = () => {
    const { dataset, datasetConfiguration } = this.props;
    const dataSource: Array<{
      name: string;
      description?: string;
    }> = [{ name: "Position" }, { name: "Zoom" }, { name: "Rotation" }];
    const additionalData: typeof dataSource = (
      [
        "fourBit",
        "interpolation",
        "renderMissingDataBlack",
        "loadingStrategy",
        "segmentationPatternOpacity",
        "blendMode",
      ] as Array<keyof RecommendedConfiguration>
    ).map((key) => ({
      name: settings[key] as string,
      description: settingsTooltips[key],
    }));
    dataSource.push(...additionalData);
    Modal.confirm({
      title: "Save current view configuration as default?",
      width: 700,
      content: (
        <>
          Do you really want to save your current view configuration as the dataset's default?
          <br />
          This will overwrite the current default view configuration.
          <br />
          This includes all color and segmentation layer settings, currently active mappings (even
          those of disabled layers), as well as these additional settings:
          <br />
          <br />
          {dataSource.map((field, index) => {
            let delimiter = index === dataSource.length - 1 ? "" : ", ";
            delimiter = index === dataSource.length - 2 ? " and " : delimiter;
            return field.description ? (
              <>
                {field.name}{" "}
                <FastTooltip title={field.description} key={`tooltip_${field.name}`}>
                  <InfoCircleOutlined style={{ color: "gray", marginRight: 0 }} />
                </FastTooltip>
                {delimiter}
              </>
            ) : (
              `${field.name}${delimiter}`
            );
          })}
          .
        </>
      ),
      onOk: async () => {
        try {
          const { flycam, temporaryConfiguration } = Store.getState();
          const position = V3.floor(getPosition(flycam));
          const zoom = flycam.zoomStep;
          const { activeMappingByLayer } = temporaryConfiguration;
          const completeDatasetConfiguration = Object.assign({}, datasetConfiguration, {
            position,
            zoom,
          });
          const updatedLayers = {
            ...completeDatasetConfiguration.layers,
          } as DatasetConfiguration["layers"];
          Object.keys(activeMappingByLayer).forEach((layerName) => {
            const mappingInfo = activeMappingByLayer[layerName];
            if (
              mappingInfo.mappingStatus === MappingStatusEnum.ENABLED &&
              mappingInfo.mappingName != null
            ) {
              updatedLayers[layerName] = {
                ...updatedLayers[layerName],
                mapping: {
                  name: mappingInfo.mappingName,
                  type: mappingInfo.mappingType,
                },
              };
            } else {
              updatedLayers[layerName] = {
                ...updatedLayers[layerName],
                mapping: null,
              };
            }
          });
          const updatedConfiguration = {
            ...completeDatasetConfiguration,
            layers: updatedLayers,
          };
          await updateDatasetDefaultConfiguration(dataset.id, updatedConfiguration);
          Toast.success("Successfully saved the current view configuration as default.");
        } catch (error) {
          Toast.error(
            "Failed to save the current view configuration as default. Please look at the console for more details.",
          );
          ErrorHandling.notify(error as Error);
          console.error(error);
        }
      },
    });
  };

  onSortLayerSettingsEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // Fix for having a grabbing cursor during dragging from https://github.com/clauderic/react-sortable-hoc/issues/328#issuecomment-1005835670.
    document.body.classList.remove("is-dragging");
    const { colorLayerOrder } = this.props.datasetConfiguration;

    if (over) {
      const oldIndex = colorLayerOrder.indexOf(active.id as string);
      const newIndex = colorLayerOrder.indexOf(over.id as string);
      const movedElement = colorLayerOrder[oldIndex];

      const newIndexClipped = Math.min(newIndex, colorLayerOrder.length - 1);
      const newLayerOrder = update(colorLayerOrder, {
        $splice: [
          [oldIndex, 1],
          [newIndexClipped, 0, movedElement],
        ],
      });
      this.props.onChange("colorLayerOrder", newLayerOrder);
    }
  };

  render() {
    const { layers, colorLayerOrder } = this.props.datasetConfiguration;
    const LayerSettings = this.LayerSettings;

    const segmentationLayerNames = Object.keys(layers).filter(
      (layerName) => !getIsColorLayer(this.props.dataset, layerName),
    );
    const hasLessThanTwoColorLayers = colorLayerOrder.length < 2;
    const colorLayerSettings = colorLayerOrder.map((layerName, index) => {
      return (
        <LayerSettings
          key={layerName}
          layerName={layerName}
          layerConfiguration={layers[layerName]}
          isColorLayer
          isLastLayer={index === colorLayerOrder.length - 1}
          hasLessThanTwoColorLayers={hasLessThanTwoColorLayers}
        />
      );
    });
    const segmentationLayerSettings = segmentationLayerNames.map((layerName, index) => {
      return (
        <LayerSettings
          key={layerName}
          layerName={layerName}
          isLastLayer={index === segmentationLayerNames.length - 1}
          layerConfiguration={layers[layerName]}
          isColorLayer={false}
        />
      );
    });

    const state = Store.getState();
    const canBeMadeHybrid =
      this.props.annotation.skeleton === null &&
      this.props.annotation.annotationType === APIAnnotationTypeEnum.Explorational &&
      state.task === null;

    return (
      <div className="tracing-settings-menu">
        <DndContext
          onDragEnd={this.onSortLayerSettingsEnd}
          onDragStart={() =>
            colorLayerOrder.length > 1 && document.body.classList.add("is-dragging")
          }
        >
          <SortableContext
            items={colorLayerOrder.map((layerName) => layerName)}
            strategy={verticalListSortingStrategy}
          >
            {colorLayerSettings}
          </SortableContext>
        </DndContext>

        {segmentationLayerSettings}
        <SkeletonLayerSettings />

        {this.props.annotation.isUpdatingCurrentlyAllowed &&
        this.props.controlMode === ControlModeEnum.TRACE ? (
          <>
            <Divider />
            <Row justify="center" align="middle">
              <Button onClick={this.showAddVolumeLayerModal}>
                <PlusOutlined />
                Add Volume Annotation Layer
              </Button>
            </Row>
          </>
        ) : null}

        {this.props.annotation.isUpdatingCurrentlyAllowed && canBeMadeHybrid ? (
          <Row justify="center" align="middle">
            <Button
              onClick={this.addSkeletonAnnotationLayer}
              style={{
                marginTop: 10,
              }}
            >
              <PlusOutlined />
              Add Skeleton Annotation Layer
            </Button>
          </Row>
        ) : null}

        {this.props.controlMode === ControlModeEnum.VIEW && this.props.isAdminOrDatasetManager ? (
          <Row justify="center" align="middle">
            <FastTooltip title="Save the current view configuration as default for all users.">
              <Button onClick={this.saveViewConfigurationAsDefault}>
                <SaveOutlined />
                Save View Configuration as Default
              </Button>
            </FastTooltip>
          </Row>
        ) : null}

        {this.state.layerToMergeWithFallback != null ? (
          <MaterializeVolumeAnnotationModal
            selectedVolumeLayer={this.state.layerToMergeWithFallback}
            handleClose={() => this.setState({ layerToMergeWithFallback: null })}
          />
        ) : null}

        {this.state.isAddVolumeLayerModalVisible ? (
          <AddVolumeLayerModal
            dataset={this.props.dataset}
            onCancel={this.hideAddVolumeLayerModal}
            annotation={this.props.annotation}
            preselectedLayerName={this.state.preselectedSegmentationLayerName}
            disableLayerSelection={this.state.segmentationLayerWasPreselected}
          />
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state: WebknossosState) => ({
  datasetConfiguration: state.datasetConfiguration,
  histogramData: state.temporaryConfiguration.histogramData,
  dataset: state.dataset,
  annotation: state.annotation,
  controlMode: state.temporaryConfiguration.controlMode,
  isAdminOrDatasetManager:
    state.activeUser != null ? isUserAdminOrDatasetManager(state.activeUser) : false,
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  onChange(propertyName: keyof DatasetConfiguration, value: ValueOf<DatasetConfiguration>) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },

  onChangeLayer(
    layerName: string,
    propertyName: keyof DatasetLayerConfiguration,
    value: ValueOf<DatasetLayerConfiguration>,
  ) {
    dispatch(updateLayerSettingAction(layerName, propertyName, value));
  },

  reloadHistogram(layerName: string) {
    dispatch(reloadHistogramAction(layerName));
  },

  addSkeletonLayerToAnnotation() {
    dispatch(
      pushSaveQueueTransactionIsolated(
        addLayerToAnnotation({
          typ: "Skeleton",
          name: "skeleton",
          fallbackLayerName: undefined,
        }),
      ),
    );
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(DatasetSettings);
