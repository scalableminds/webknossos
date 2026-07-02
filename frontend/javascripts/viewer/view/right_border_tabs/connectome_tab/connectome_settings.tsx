import { SettingOutlined } from "@ant-design/icons";
import { getConnectomeFilesForDatasetLayer } from "admin/rest_api";
import { Col, Popover, Row, Select, Tooltip } from "antd";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { settings } from "messages";
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import type { APISegmentationLayer } from "types/api_types";
import { userSettings } from "types/schemas/user_settings.schema";
import defaultState from "viewer/default_state";
import {
  getConnectomeDataForLayer,
  isTracingLayerWithoutFallback,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  updateConnectomeFileListAction,
  updateCurrentConnectomeFileAction,
} from "viewer/model/actions/connectome_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import ButtonComponent from "viewer/view/components/button_component";
import NumberSliderSetting from "viewer/view/left_border_tabs/components/number_slider_setting";
import { getBaseSegmentationName } from "viewer/view/right_border_tabs/segments_tab/segments_view_helper";

const { Option } = Select;

type Props = {
  segmentationLayer: APISegmentationLayer | null | undefined;
};

function ConnectomeSettings({ segmentationLayer }: Props) {
  const dispatch = useDispatch();

  const dataset = useWkSelector((state) => state.dataset);
  const connectomeData = useWkSelector((state) =>
    segmentationLayer != null ? getConnectomeDataForLayer(state, segmentationLayer.name) : null,
  );
  const particleSize = useWkSelector((state) => state.userConfiguration.particleSize);

  const availableConnectomeFiles = connectomeData?.availableConnectomeFiles ?? null;
  const currentConnectomeFile = connectomeData?.currentConnectomeFile ?? null;
  const pendingConnectomeFileName = connectomeData?.pendingConnectomeFileName ?? null;

  // Fetch the list of connectome files once a (new) segmentation layer becomes available.
  // If availableConnectomeFiles is not null, they have already been fetched.
  const { data: fetchedConnectomeFiles } = useQueryWithErrorHandling(
    {
      queryKey: ["connectomeFiles", dataset.id, segmentationLayer?.name],
      queryFn: () => {
        if (segmentationLayer == null) {
          // Guaranteed by the enabled flag, but TS cannot infer this in the closure
          throw new Error("Cannot fetch connectome files without a segmentation layer.");
        }
        return getConnectomeFilesForDatasetLayer(
          dataset.dataStore.url,
          dataset,
          getBaseSegmentationName(segmentationLayer),
        );
      },
      enabled:
        segmentationLayer != null &&
        !isTracingLayerWithoutFallback(segmentationLayer) &&
        availableConnectomeFiles == null,
      refetchOnWindowFocus: false,
      // The Redux store is the source of truth for the file list, don't persist the query
      meta: { persist: false },
    },
    "Failed to load the list of connectome files.",
  );

  // Transfer the fetched connectome files to the Redux store and select the initial file.
  useEffect(() => {
    if (
      fetchedConnectomeFiles == null ||
      segmentationLayer == null ||
      availableConnectomeFiles != null
    )
      return;
    const layerName = segmentationLayer.name;
    dispatch(updateConnectomeFileListAction(layerName, fetchedConnectomeFiles));

    if (currentConnectomeFile == null && fetchedConnectomeFiles.length > 0) {
      // If there was a pending connectome file name, use it, otherwise select the first one
      const connectomeFileName =
        pendingConnectomeFileName != null
          ? pendingConnectomeFileName
          : fetchedConnectomeFiles[0].connectomeFileName;
      dispatch(updateCurrentConnectomeFileAction(layerName, connectomeFileName));
    }
  }, [
    fetchedConnectomeFiles,
    segmentationLayer,
    availableConnectomeFiles,
    currentConnectomeFile,
    pendingConnectomeFileName,
    dispatch,
  ]);

  const handleConnectomeFileSelected = (connectomeFileName: string | null | undefined) => {
    if (segmentationLayer != null && connectomeFileName != null) {
      dispatch(updateCurrentConnectomeFileAction(segmentationLayer.name, connectomeFileName));
    }
  };

  const updateParticleSize = (value: number) => {
    dispatch(updateUserSettingAction("particleSize", value));
  };

  const renderConnectomeFileSettings = () => {
    const currentConnectomeFileName =
      currentConnectomeFile != null ? currentConnectomeFile.connectomeFileName : null;
    return (
      <>
        <Row
          style={{
            width: 350,
          }}
        >
          <Col span={9}>
            <label className="setting-label">Connectome File</label>
          </Col>
          <Col span={15}>
            <Tooltip
              title="Select a connectome file from which synapses will be loaded."
              placement="top"
            >
              <Select
                placeholder="Select a connectome file"
                value={currentConnectomeFileName}
                onChange={handleConnectomeFileSelected}
                size="small"
                loading={availableConnectomeFiles == null}
                style={{
                  width: "100%",
                }}
              >
                {availableConnectomeFiles?.length ? (
                  availableConnectomeFiles.map((connectomeFile) => (
                    <Option
                      key={connectomeFile.connectomeFileName}
                      value={connectomeFile.connectomeFileName}
                    >
                      {connectomeFile.connectomeFileName}
                    </Option>
                  ))
                ) : (
                  <Option value="" disabled>
                    No files available
                  </Option>
                )}
              </Select>
            </Tooltip>
          </Col>
        </Row>
        <Row
          style={{
            width: 350,
          }}
        >
          <Col span={24}>
            <NumberSliderSetting
              label={settings.particleSize}
              min={userSettings.particleSize.minimum}
              max={userSettings.particleSize.maximum}
              step={0.1}
              value={particleSize}
              onChange={updateParticleSize}
              defaultValue={defaultState.userConfiguration.particleSize}
            />
          </Col>
        </Row>
      </>
    );
  };

  return (
    <Popover content={renderConnectomeFileSettings} trigger="click" placement="bottomRight">
      <ButtonComponent
        icon={<SettingOutlined />}
        title="Configure Connectome Settings"
        variant="text"
        color="default"
      />
    </Popover>
  );
}

export default ConnectomeSettings;
