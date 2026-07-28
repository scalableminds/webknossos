import { CloseCircleOutlined } from "@ant-design/icons";
import { Alert, Divider, Space, Tooltip } from "antd";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useDispatch } from "react-redux";
import type { APIConnectomeFile, APISegmentationLayer } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import ButtonComponent from "viewer/view/components/button_component";
import InputComponent from "viewer/view/components/input_component";
import ConnectomeFilters from "viewer/view/right_border_tabs/connectome_tab/connectome_filters";
import ConnectomeSettings from "viewer/view/right_border_tabs/connectome_tab/connectome_settings";
import type { ConnectomeData } from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";

function ConnectomeMappingActivationAlert({
  segmentationLayer,
  currentConnectomeFile,
}: {
  segmentationLayer: APISegmentationLayer | null | undefined;
  currentConnectomeFile: APIConnectomeFile | null | undefined;
}) {
  const dispatch = useDispatch();
  const mappingInfo = useWkSelector((state) =>
    segmentationLayer != null
      ? getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, segmentationLayer.name)
      : null,
  );

  const isConnectomeMappingActive =
    mappingInfo == null ||
    currentConnectomeFile == null ||
    (mappingInfo.mappingName === currentConnectomeFile.mappingName &&
      mappingInfo.mappingStatus !== MappingStatusEnum.DISABLED);

  if (isConnectomeMappingActive) return null;

  const activateConnectomeMapping = () => {
    if (segmentationLayer == null || currentConnectomeFile == null) return;
    dispatch(
      setMappingAction(segmentationLayer.name, currentConnectomeFile.mappingName, "HDF5", false, {
        showLoadingIndicator: true,
      }),
    );
  };

  return (
    <Alert
      title={
        <>
          The mapping this connectome was computed for is not active.{" "}
          <a href="#" onClick={activateConnectomeMapping}>
            Click to activate.
          </a>
        </>
      }
      type="info"
      showIcon
      style={{
        marginBottom: 10,
      }}
    />
  );
}

type Props = {
  segmentationLayer: APISegmentationLayer | null | undefined;
  currentConnectomeFile: APIConnectomeFile | null | undefined;
  activeAgglomerateIds: Array<number>;
  availableSynapseTypes: Array<string>;
  connectomeData: ConnectomeData | null | undefined;
  onUpdateFilteredConnectomeData: (
    filteredConnectomeData: ConnectomeData | null | undefined,
  ) => void;
  onSetActiveAgglomerateIds: (agglomerateIds: Array<number>) => void;
  onReset: () => void;
};

function ConnectomeHeader({
  segmentationLayer,
  currentConnectomeFile,
  activeAgglomerateIds,
  availableSynapseTypes,
  connectomeData,
  onUpdateFilteredConnectomeData,
  onSetActiveAgglomerateIds,
  onReset,
}: Props) {
  const handleChangeActiveSegment = (evt: React.SyntheticEvent) => {
    const target = evt.target as HTMLInputElement;
    const agglomerateIds = target.value
      .split(",")
      .map((part: string) => Number.parseInt(part, 10))
      .filter((id: number) => !Number.isNaN(id));
    onSetActiveAgglomerateIds(agglomerateIds);
    target.blur();
  };

  const activeAgglomerateIdString = activeAgglomerateIds.length
    ? activeAgglomerateIds.join(",")
    : "";
  const disabled = currentConnectomeFile == null;

  return (
    <>
      <Space>
        <Tooltip title="Show Synaptic Connections for Segment ID(s)">
          <InputComponent
            value={activeAgglomerateIdString}
            onPressEnter={handleChangeActiveSegment}
            placeholder="Enter Segment ID(s)"
            style={{
              width: 220,
            }}
            disabled={disabled}
            size="small"
          />
        </Tooltip>
        <ButtonComponent
          onClick={onReset}
          disabled={disabled}
          icon={<CloseCircleOutlined />}
          title="Reset"
          variant="text"
          color="default"
        />
        <ConnectomeFilters
          availableSynapseTypes={availableSynapseTypes}
          connectomeData={connectomeData}
          onUpdateFilteredConnectomeData={onUpdateFilteredConnectomeData}
          disabled={disabled}
        />
        <ConnectomeSettings segmentationLayer={segmentationLayer} />
      </Space>
      <Divider size="small" />
      <ConnectomeMappingActivationAlert
        segmentationLayer={segmentationLayer}
        currentConnectomeFile={currentConnectomeFile}
      />
    </>
  );
}

export default ConnectomeHeader;
