import { ReloadOutlined } from "@ant-design/icons";
import { ConfigProvider, Empty, Select, Space, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import type { APIMeshFileInfo } from "types/api_types";
import { getMagInfoOfVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { updateTemporarySettingAction } from "viewer/model/actions/settings_actions";
import ButtonComponent from "viewer/view/components/button_component";
import type { MeshFiles } from "./hooks/use_mesh_files";
import { formatMagWithLabel } from "./segments_view_helper";

const { Option } = Select;

const formatMeshFile = (meshFile: APIMeshFileInfo): string => {
  if (meshFile.mappingName == null) return meshFile.name;
  return `${meshFile.name} (${meshFile.mappingName})`;
};

function renderEmptyMeshFileSelect() {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="No mesh file found. Click the + icon to compute a mesh file."
    />
  );
}

/*
 * Popover content for configuring mesh computation: which precomputed mesh
 * file to use and the quality of ad-hoc computed meshes.
 */
export function MeshSettingsPopover({ meshFiles }: { meshFiles: MeshFiles }) {
  const dispatch = useDispatch();
  const { availableMeshFiles, currentMeshFile, setCurrentMeshFile, refreshMeshFiles } = meshFiles;
  const magInfo = useWkSelector(getMagInfoOfVisibleSegmentationLayer);
  const preferredQualityForMeshAdHocComputation = useWkSelector(
    (state) => state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
  );

  return (
    <div>
      <Typography.Paragraph>
        Select a precomputed mesh file:
        <ConfigProvider
          renderEmpty={renderEmptyMeshFileSelect}
          theme={{ cssVar: { key: "antd-app-theme" } }}
        >
          <Space.Compact style={{ width: "100%" }}>
            <Select
              placeholder="Select a mesh file"
              value={currentMeshFile != null ? currentMeshFile.name : null}
              onChange={setCurrentMeshFile}
              loading={availableMeshFiles == null}
              popupMatchSelectWidth={false}
              style={{ width: "100%" }}
            >
              {availableMeshFiles ? (
                availableMeshFiles.map((meshFile) => (
                  <Option key={meshFile.name} value={meshFile.name}>
                    {formatMeshFile(meshFile)}
                  </Option>
                ))
              ) : (
                <Option value="" disabled>
                  No files available.
                </Option>
              )}
            </Select>
            <ButtonComponent icon={<ReloadOutlined />} onClick={refreshMeshFiles} />
          </Space.Compact>
        </ConfigProvider>
      </Typography.Paragraph>

      <Typography.Paragraph>
        <FastTooltip title="The higher the quality, the more computational resources are required">
          Select the quality for ad-hoc mesh computation:
        </FastTooltip>
        <Select
          value={magInfo.getClosestExistingIndex(preferredQualityForMeshAdHocComputation)}
          onChange={(magIndex) =>
            dispatch(
              updateTemporarySettingAction("preferredQualityForMeshAdHocComputation", magIndex),
            )
          }
          popupMatchSelectWidth={false}
          style={{ width: "100%" }}
        >
          {magInfo.getMagsWithIndices().map(([log2Index, mag], index) => (
            <Option value={log2Index} key={log2Index}>
              {formatMagWithLabel(mag, index)}
            </Option>
          ))}
        </Select>
      </Typography.Paragraph>
    </div>
  );
}
