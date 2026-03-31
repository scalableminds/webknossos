import { Form, InputNumber, Modal, Space, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { getRandomColor } from "libs/utils";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { APIJobCommand } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getDatasetBoundingBox } from "viewer/model/accessors/dataset_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";

// These values should be kept in sync with the documentation
// docs/automation/choosing_mags_and_bboxes.md
const DEFAULT_BOX_COUNT_NEURON = 25;
const DEFAULT_BOX_COUNT_INSTANCE = 20;
const DEFAULT_BOX_SIZE_NEURON: Vector3 = [85, 85, 32];
const DEFAULT_BOX_SIZE_INSTANCE: Vector3 = [64, 64, 64];

function getDefaults(jobType: APIJobCommand | null) {
  if (jobType === APIJobCommand.TRAIN_INSTANCE_MODEL) {
    return { count: DEFAULT_BOX_COUNT_INSTANCE, size: DEFAULT_BOX_SIZE_INSTANCE };
  }
  return { count: DEFAULT_BOX_COUNT_NEURON, size: DEFAULT_BOX_SIZE_NEURON };
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  // When provided, box positions are snapped to this magnification and sizes are interpreted
  // as voxels at the selected magnification level (not mag 1).
  magnification: Vector3 | null;
  // When provided, sensible defaults are pre-filled based on the training type.
  jobType: APIJobCommand | null;
};

export default function GenerateBoundingBoxesModal({
  isOpen,
  onClose,
  magnification,
  jobType,
}: Props) {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);

  const defaults = getDefaults(jobType);
  const [numberOfBoxes, setNumberOfBoxes] = useState(defaults.count);
  const [sizeX, setSizeX] = useState(defaults.size[0]);
  const [sizeY, setSizeY] = useState(defaults.size[1]);
  const [sizeZ, setSizeZ] = useState(defaults.size[2]);

  useEffect(() => {
    const { count, size } = getDefaults(jobType);
    setNumberOfBoxes(count);
    setSizeX(size[0]);
    setSizeY(size[1]);
    setSizeZ(size[2]);
  }, [jobType]);

  const handleGenerate = () => {
    const mag: Vector3 = magnification ?? [1, 1, 1];

    // Convert mag-level dimensions to mag1 voxels
    const sizeInMag1: Vector3 = [sizeX * mag[0], sizeY * mag[1], sizeZ * mag[2]];

    const datasetBbox = getDatasetBoundingBox(dataset);
    const { min, max } = datasetBbox;

    // Valid range for the top-left corner of a generated box
    const placementMax: Vector3 = [
      max[0] - sizeInMag1[0],
      max[1] - sizeInMag1[1],
      max[2] - sizeInMag1[2],
    ];

    // Dataset too small in at least one dimension
    if (placementMax[0] < min[0] || placementMax[1] < min[1] || placementMax[2] < min[2]) {
      return;
    }

    const MAX_RETRIES = 500;
    const placedBoxes: BoundingBox[] = [];

    const samplePosition = (): Vector3 =>
      [0, 1, 2].map((dim) => {
        const range = placementMax[dim] - min[dim];
        const rawOffset = Math.random() * range;
        const snappedOffset = Math.floor(rawOffset / mag[dim]) * mag[dim];
        return min[dim] + snappedOffset;
      }) as Vector3;

    let placed = 0;
    let retries = 0;
    while (placed < numberOfBoxes && retries < MAX_RETRIES) {
      const boxMin = samplePosition();
      const boxMax: Vector3 = [
        boxMin[0] + sizeInMag1[0],
        boxMin[1] + sizeInMag1[1],
        boxMin[2] + sizeInMag1[2],
      ];
      const candidate = new BoundingBox({ min: boxMin, max: boxMax });

      const overlaps = placedBoxes.some(
        (existing) => existing.intersectedWith(candidate).getVolume() > 0,
      );

      if (overlaps) {
        retries++;
        continue;
      }

      placedBoxes.push(candidate);
      dispatch(
        addUserBoundingBoxAction({
          boundingBox: { min: boxMin, max: boxMax },
          name: `Box ${placed + 1}`,
          color: getRandomColor(),
          isVisible: true,
        }),
      );
      placed++;
    }

    onClose();
  };

  const magLabel = magnification
    ? `${magnification[0]}-${magnification[1]}-${magnification[2]}`
    : "1-1-1";

  return (
    <Modal
      title="Auto-generate Bounding Boxes"
      open={isOpen}
      onCancel={onClose}
      onOk={handleGenerate}
      okText="Generate"
      width={500}
    >
      <Typography.Paragraph type="secondary">
        Bounding boxes mark the regions used for AI model training. This tool places them at random
        positions throughout your dataset to give the model a varied sample. After generating,
        review and remove any that fall in empty or uninformative areas.{" "}
        <Typography.Link
          href="https://docs.webknossos.org/webknossos/automation/choosing_mags_and_bboxes.html"
          target="_blank"
          rel="noreferrer"
        >
          Learn more about choosing bounding boxes for training.
        </Typography.Link>
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="Number of bounding boxes">
          <InputNumber
            min={1}
            max={500}
            value={numberOfBoxes}
            onChange={(value) => setNumberOfBoxes(value ?? 1)}
            style={{ width: 120 }}
          />
        </Form.Item>
        <Form.Item
          label="Box size (voxels)"
          extra={
            <Typography.Text type="secondary">
              {magnification
                ? `Size in voxels at magnification ${magLabel}. Positions are automatically aligned to this magnification.`
                : "Size in voxels at full resolution (mag 1-1-1)."}
            </Typography.Text>
          }
        >
          <Space>
            <Space.Compact>
              <Space.Addon>X</Space.Addon>
              <InputNumber
                min={1}
                value={sizeX}
                onChange={(v) => setSizeX(v ?? 1)}
                style={{ width: 110 }}
              />
            </Space.Compact>
            <Space.Compact>
              <Space.Addon>Y</Space.Addon>
              <InputNumber
                min={1}
                value={sizeY}
                onChange={(v) => setSizeY(v ?? 1)}
                style={{ width: 110 }}
              />
            </Space.Compact>
            <Space.Compact>
              <Space.Addon>Z</Space.Addon>
              <InputNumber
                min={1}
                value={sizeZ}
                onChange={(v) => setSizeZ(v ?? 1)}
                style={{ width: 110 }}
              />
            </Space.Compact>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}
