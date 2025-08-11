import { InfoCircleOutlined } from "@ant-design/icons";
import { Form, Space, Tooltip } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import { ControlModeEnum } from "viewer/constants";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import type { UserBoundingBox } from "viewer/store";
import { isBoundingBoxExportable } from "../../download_modal_view";
import { BoundingBoxSelection } from "./bounding_box_selection";

type BoundingBoxSelectionProps = {
  isBoundingBoxConfigurable?: boolean;
  userBoundingBoxes: UserBoundingBox[];
  isSuperUser: boolean;
  showVolume: boolean;
  onChangeSelectedBoundingBox: (bBoxId: number | null) => void;
  value: number | null;
};

export function BoundingBoxSelectionFormItem({
  isBoundingBoxConfigurable,
  userBoundingBoxes,
  isSuperUser,
  showVolume = false,
  onChangeSelectedBoundingBox,
  value: selectedBoundingBoxId,
}: BoundingBoxSelectionProps): JSX.Element {
  const dataset = useWkSelector((state) => state.dataset);
  const isInDatasetViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const colorLayer = getColorLayers(dataset)[0];
  const mag1 = colorLayer.resolutions[0];
  const howToCreateBoundingBoxText = isInDatasetViewMode
    ? "To process only a part of the dataset, please create an annotation and create a bounding box in it using the bounding box tool in the toolbar at the top."
    : "You can create a new bounding box for the desired volume with the bounding box tool in the toolbar at the top. The created bounding boxes will be listed below.";
  return (
    <div style={isBoundingBoxConfigurable ? {} : { display: "none" }}>
      <Form.Item
        label={
          <div>
            <Space>
              Bounding Box
              <Tooltip
                title={`Please select the bounding box which should be processed. Note that large bounding boxes can take very long. ${howToCreateBoundingBoxText}`}
              >
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          </div>
        }
        name="boundingBoxId"
        rules={[
          {
            required: isBoundingBoxConfigurable,
            message: "Please select the bounding box for which the inferral should be computed.",
          },
          {
            validator: (_rule, value) => {
              if (!isBoundingBoxConfigurable || isSuperUser) return Promise.resolve();

              const selectedBoundingBox = userBoundingBoxes.find((bbox) => bbox.id === value);
              let rejectionReason = "";
              if (selectedBoundingBox) {
                const { isExportable, alerts: _ } = isBoundingBoxExportable(
                  selectedBoundingBox.boundingBox,
                  mag1,
                );
                if (isExportable) return Promise.resolve();
                rejectionReason = `The volume of the selected bounding box is too large. The AI neuron segmentation trial is only supported for up to ${
                  features().exportTiffMaxVolumeMVx
                } Megavoxels. Additionally, no bounding box edge should be longer than ${
                  features().exportTiffMaxEdgeLengthVx
                }vx.`;
              }
              // In case no bounding box was selected, the rejectionReason will be "", because the previous rule already checks that.
              return Promise.reject(rejectionReason);
            },
          },
        ]}
        hidden={!isBoundingBoxConfigurable}
      >
        <BoundingBoxSelection
          userBoundingBoxes={userBoundingBoxes}
          setSelectedBoundingBoxId={onChangeSelectedBoundingBox}
          value={selectedBoundingBoxId}
          showVolume={showVolume}
        />
      </Form.Item>
    </div>
  );
}
