import { Checkbox, Form, InputNumber, Modal, Select, Space, Typography } from "antd";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { getRandomColor } from "libs/utils";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { batchActions } from "redux-batched-actions";
import { APIJobCommand } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getDatasetBoundingBox,
  getSomeMagInfoForDataset,
} from "viewer/model/accessors/dataset_accessor";
import { getSomeTracing } from "viewer/model/accessors/tracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";

// These values should be kept in sync with the documentation:
// docs/automation/choosing_mags_and_bboxes.md
const CUSTOM_TRAINING_TYPE = "custom";

const TRAINING_DEFAULTS: Record<
  string,
  { count: number; size: Vector3; minSize: Vector3 | null; minSizeLabel: string }
> = {
  [APIJobCommand.TRAIN_NEURON_MODEL]: {
    count: 25,
    size: [85, 85, 32],
    minSize: [85, 85, 32],
    minSizeLabel: "85×85×32",
  },
  [APIJobCommand.TRAIN_INSTANCE_MODEL]: {
    count: 20,
    size: [64, 64, 64],
    minSize: [32, 32, 32],
    minSizeLabel: "32×32×32 (64×64×64 recommended)",
  },
  [CUSTOM_TRAINING_TYPE]: {
    count: 25,
    size: [85, 85, 32],
    minSize: null,
    minSizeLabel: "",
  },
};

const DEFAULT_TRAINING_TYPE = APIJobCommand.TRAIN_NEURON_MODEL;

function getDefaults(jobType: string) {
  return TRAINING_DEFAULTS[jobType] ?? TRAINING_DEFAULTS[DEFAULT_TRAINING_TYPE];
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  // Pre-fills the magnification selector. When null, defaults to the finest available mag.
  magnification: Vector3 | null;
  // Pre-fills the training type selector. When null, defaults to neuron segmentation.
  jobType: APIJobCommand | null;
};

function GenerateBoundingBoxesModalInner({ isOpen, onClose, magnification, jobType }: Props) {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const { userBoundingBoxes: existingBoundingBoxes } = getSomeTracing(annotation);

  const [trainingType, setTrainingType] = useState<string>(jobType ?? DEFAULT_TRAINING_TYPE);

  const defaults = getDefaults(trainingType);
  const [numberOfBoxes, setNumberOfBoxes] = useState(defaults.count);
  const [sizeX, setSizeX] = useState(defaults.size[0]);
  const [sizeY, setSizeY] = useState(defaults.size[1]);
  const [sizeZ, setSizeZ] = useState(defaults.size[2]);

  const availableMags = getSomeMagInfoForDataset(dataset).getMagList();

  const initialMagIndex = (() => {
    if (magnification == null) return 0;
    const idx = availableMags.findIndex((m) => V3.equals(m, magnification));
    return idx >= 0 ? idx : 0;
  })();

  const [selectedMagIndex, setSelectedMagIndex] = useState(initialMagIndex);
  const selectedMag: Vector3 = availableMags[selectedMagIndex] ?? [1, 1, 1];

  const [avoidExistingBoxes, setAvoidExistingBoxes] = useState(true);

  // Optionally restrict the sampling space to an existing bounding box. When null, boxes are
  // sampled across the entire dataset.
  const [restrictToBoxId, setRestrictToBoxId] = useState<number | null>(null);
  const restrictToBox = existingBoundingBoxes.find((bb) => bb.id === restrictToBoxId) ?? null;

  const handleTrainingTypeChange = (value: string) => {
    setTrainingType(value);
    const { count, size } = getDefaults(value);
    setNumberOfBoxes(count);
    setSizeX(size[0]);
    setSizeY(size[1]);
    setSizeZ(size[2]);
  };

  const { minSize, minSizeLabel } = getDefaults(trainingType);
  const sizeXError = minSize != null && sizeX < minSize[0];
  const sizeYError = minSize != null && sizeY < minSize[1];
  const sizeZError = minSize != null && sizeZ < minSize[2];
  const hasSizeError = sizeXError || sizeYError || sizeZError;

  // Warn when a dimension is not a multiple of the minimum — training will work but
  // may be less efficient (the training backend pads or crops to the nearest multiple).
  const sizeXWarning = !sizeXError && minSize != null && minSize[0] > 0 && sizeX % minSize[0] !== 0;
  const sizeYWarning = !sizeYError && minSize != null && minSize[1] > 0 && sizeY % minSize[1] !== 0;
  const sizeZWarning = !sizeZError && minSize != null && minSize[2] > 0 && sizeZ % minSize[2] !== 0;
  const hasSizeWarning = sizeXWarning || sizeYWarning || sizeZWarning;

  const [isGenerating, setIsGenerating] = useState(false);

  // Computed full-resolution size for display.
  const sizeInMag1: Vector3 = V3.scale3([sizeX, sizeY, sizeZ], selectedMag);
  const isMag1 = V3.equals(selectedMag, [1, 1, 1]);

  /**
   * Generates non-overlapping bounding boxes distributed randomly across the dataset:
   * 1. Compute the valid placement range: positions where a box of `sizeInMag1` fits
   *    entirely within the dataset bounds.
   * 2. Optionally seed the collision set with any bounding boxes already present in the
   *    annotation so that new boxes do not overlap existing ones.
   * 3. Repeatedly sample a random position, snap it to the magnification grid by
   *    choosing uniformly from all discrete mag-aligned slots within the valid range,
   *    and reject candidates that overlap any already-placed box.
   * 4. Dispatch all accepted boxes to the Redux store in a single batched action and
   *    warn the user if the retry budget is exhausted before all requested boxes are placed.
   */
  const handleGenerate = () => {
    if (hasSizeError || isGenerating) return;
    setIsGenerating(true);

    // Defer the loop to allow the loading state to render first.
    setTimeout(() => {
      try {
        const mag = selectedMag;
        // Restrict sampling to a selected bounding box if one is chosen, otherwise the whole dataset.
        const samplingBbox = restrictToBox
          ? new BoundingBox(restrictToBox.boundingBox)
          : getDatasetBoundingBox(dataset);
        const { min, max } = samplingBbox;

        const placementMax: Vector3 = V3.sub(max, sizeInMag1);

        if (placementMax[0] < min[0] || placementMax[1] < min[1] || placementMax[2] < min[2]) {
          Toast.warning(
            restrictToBox
              ? "The selected box size does not fit into the selected bounding box at the chosen magnification."
              : "The selected box size does not fit into the dataset at the chosen magnification.",
          );
          return;
        }

        const MAX_RETRIES = 500;
        // Optionally seed with existing boxes so new ones don't overlap them. The bounding box used
        // to restrict the sampling space is excluded so it doesn't block all placements.
        const placedBoxes: BoundingBox[] = avoidExistingBoxes
          ? existingBoundingBoxes
              .filter((bb) => bb.id !== restrictToBoxId)
              .map((bb) => new BoundingBox(bb.boundingBox))
          : [];

        // Sample a position by choosing uniformly from the discrete set of mag-aligned
        // slots within [min, placementMax]. Snapping is applied to the absolute coordinate
        // (not the offset) to avoid misalignment when min is not itself a multiple of mag.
        const samplePosition = (): Vector3 =>
          [0, 1, 2].map((dim) => {
            const firstSlot = Math.ceil(min[dim] / mag[dim]) * mag[dim];
            const lastSlot = Math.floor(placementMax[dim] / mag[dim]) * mag[dim];
            const slotCount = Math.floor((lastSlot - firstSlot) / mag[dim]) + 1;

            if (slotCount <= 0) return firstSlot;

            const k = Math.floor(Math.random() * slotCount);
            return firstSlot + k * mag[dim];
          }) as Vector3;

        let placed = 0;
        let retries = 0;
        const actions: ReturnType<typeof addUserBoundingBoxAction>[] = [];

        while (placed < numberOfBoxes && retries < MAX_RETRIES) {
          const boxMin = samplePosition();
          const boxMax: Vector3 = V3.add(boxMin, sizeInMag1);
          const candidate = new BoundingBox({ min: boxMin, max: boxMax });

          if (
            placedBoxes.some((existing) => {
              const r = existing.intersectedWithFast(candidate);
              return (r.max[0] - r.min[0]) * (r.max[1] - r.min[1]) * (r.max[2] - r.min[2]) > 0;
            })
          ) {
            retries++;
            continue;
          }

          placedBoxes.push(candidate);
          actions.push(
            addUserBoundingBoxAction({
              boundingBox: { min: boxMin, max: boxMax },
              name: `Generated Bounding Box ${placed + 1}`,
              color: getRandomColor(),
              isVisible: true,
            }),
          );
          placed++;
        }

        if (actions.length > 0) {
          dispatch(batchActions(actions, "ADD_NEW_USER_BOUNDING_BOX") as unknown as Action);
        }

        if (placed < numberOfBoxes) {
          Toast.warning(
            `Only ${placed} of ${numberOfBoxes} boxes could be placed without overlapping.`,
          );
        }

        onClose();
      } finally {
        setIsGenerating(false);
      }
    }, 0);
  };

  const magLabel = `${selectedMag[0]}-${selectedMag[1]}-${selectedMag[2]}`;

  return (
    <Modal
      title="Generate Bounding Boxes"
      open={isOpen}
      onCancel={onClose}
      onOk={handleGenerate}
      okText="Generate"
      okButtonProps={{ disabled: hasSizeError || isGenerating, loading: isGenerating }}
      width={520}
    >
      <Typography.Paragraph type="secondary">
        Bounding boxes mark the regions used for AI model training. This tool places non-overlapping
        boxes at random positions throughout your dataset to give the model a varied sample. After
        generating, review and remove any that fall in empty or uninformative areas.{" "}
        <Typography.Link
          href="https://docs.webknossos.org/webknossos/automation/choosing_mags_and_bboxes.html"
          target="_blank"
          rel="noreferrer"
        >
          Learn more about choosing bounding boxes for training.
        </Typography.Link>
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="Presets for Training type">
          <Select
            value={trainingType}
            onChange={handleTrainingTypeChange}
            options={[
              { value: APIJobCommand.TRAIN_NEURON_MODEL, label: "Neuron segmentation" },
              {
                value: APIJobCommand.TRAIN_INSTANCE_MODEL,
                label: "Instance segmentation (e.g. nuclei, mitochondria)",
              },
              { value: CUSTOM_TRAINING_TYPE, label: "Custom (no size constraints)" },
            ]}
          />
        </Form.Item>
        <Form.Item
          label="Magnification"
          extra="Box sizes and positions are defined at this magnification level."
        >
          <Select
            value={selectedMagIndex}
            onChange={setSelectedMagIndex}
            options={availableMags.map((mag, index) => ({
              value: index,
              label: `${mag[0]}-${mag[1]}-${mag[2]}`,
            }))}
          />
        </Form.Item>
        <Form.Item
          label="Restrict to bounding box"
          extra="Limit the sampling space to an existing bounding box. By default, boxes are placed across the entire dataset."
        >
          <Select
            value={restrictToBoxId}
            onChange={setRestrictToBoxId}
            allowClear
            placeholder="Entire dataset"
            options={existingBoundingBoxes.map((bb) => ({
              value: bb.id,
              label: bb.name || `Bounding box ${bb.id}`,
            }))}
          />
        </Form.Item>
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
          label={`Box size in voxels at magnification ${magLabel}`}
          validateStatus={hasSizeError ? "error" : hasSizeWarning ? "warning" : undefined}
          help={
            hasSizeError
              ? `Minimum size for this training type: ${minSizeLabel} voxels.`
              : hasSizeWarning
                ? `For optimal training, each dimension should be a multiple of the minimum size (${minSizeLabel} voxels).`
                : !isMag1
                  ? `Full-resolution size (mag 1): ${sizeInMag1[0]}×${sizeInMag1[1]}×${sizeInMag1[2]} vx`
                  : undefined
          }
        >
          <Space>
            <Space.Compact>
              <Space.Addon>X</Space.Addon>
              <InputNumber
                min={1}
                value={sizeX}
                onChange={(v) => setSizeX(v ?? 1)}
                status={sizeXError ? "error" : sizeXWarning ? "warning" : undefined}
                style={{ width: 120 }}
              />
            </Space.Compact>
            <Space.Compact>
              <Space.Addon>Y</Space.Addon>
              <InputNumber
                min={1}
                value={sizeY}
                onChange={(v) => setSizeY(v ?? 1)}
                status={sizeYError ? "error" : sizeYWarning ? "warning" : undefined}
                style={{ width: 120 }}
              />
            </Space.Compact>
            <Space.Compact>
              <Space.Addon>Z</Space.Addon>
              <InputNumber
                min={1}
                value={sizeZ}
                onChange={(v) => setSizeZ(v ?? 1)}
                status={sizeZError ? "error" : sizeZWarning ? "warning" : undefined}
                style={{ width: 120 }}
              />
            </Space.Compact>
          </Space>
        </Form.Item>
        <Form.Item>
          <Checkbox
            checked={avoidExistingBoxes}
            onChange={(e) => setAvoidExistingBoxes(e.target.checked)}
          >
            Avoid overlapping with existing bounding boxes
          </Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function GenerateBoundingBoxesModal(props: Props) {
  return <GenerateBoundingBoxesModalInner key={props.jobType} {...props} />;
}
