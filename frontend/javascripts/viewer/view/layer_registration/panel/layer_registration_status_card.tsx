import { BulbOutlined, WarningOutlined } from "@ant-design/icons";
import { Badge, Button, Flex, Typography, theme } from "antd";
import { pluralize } from "libs/utils";
import type React from "react";
import type { VoxelSize } from "types/api_types";
import { Keycap } from "viewer/view/components/keycap";
import {
  formatResidual,
  getLandmarkTreeName,
  isCompletePair,
  type LandmarkPair,
  VIEW_NAMES,
} from "../helpers/layer_registration_helpers";
import type { NextStep } from "../helpers/layer_registration_next_step";
import {
  MIN_LANDMARK_PAIR_COUNT,
  type TransformEstimation,
} from "../helpers/layer_registration_transform_estimation";

function getNextStepContent(
  nextStep: NextStep,
  onSelectPair: (pair: LandmarkPair) => void,
  onSelectMovingLayer: (layerName: string) => void,
): { text: React.ReactNode; action?: { label: string; onClick: () => void } } {
  switch (nextStep.type) {
    case "placeFirstLandmark":
      return {
        text: `Click a clear structure in the left view to place ${getLandmarkTreeName(1)}.`,
      };
    case "completePair": {
      const { pair, missingSide } = nextStep;
      return {
        text: `${getLandmarkTreeName(pair.pairId ?? 0)}: click the matching spot in the ${VIEW_NAMES[missingSide]} view.`,
        action: { label: "Show it", onClick: () => onSelectPair(pair) },
      };
    }
    case "placeMorePairs":
      return {
        text: `Place ${nextStep.missingPairCount} more ${pluralize("pair", nextStep.missingPairCount)} to get a transform.`,
      };
    case "checkOutlier": {
      const { pair, errorFactor } = nextStep;
      return {
        text: `${getLandmarkTreeName(pair.pairId ?? 0)} has ${errorFactor.toFixed(1)}× the mean error. It was probably clicked off-target.`,
        action: { label: "Show it", onClick: () => onSelectPair(pair) },
      };
    }
    case "compareAndApply":
      return {
        text: (
          <>
            Press <Keycap>T</Keycap> in a view to compare transformed and untransformed. If it looks
            right, apply it to the dataset.
          </>
        ),
      };
    case "nextLayer": {
      const { layerName, completePairCount, appliedState } = nextStep;
      const state =
        completePairCount === 0
          ? "has no landmarks yet"
          : appliedState === "transformEstimationFailed"
            ? "needs more landmark pairs"
            : "is not applied yet";
      return {
        text: `Next layer: ${layerName} ${state}.`,
        action: { label: "Switch", onClick: () => onSelectMovingLayer(layerName) },
      };
    }
    case "allApplied":
      return {
        text: nextStep.hasSeveralMovingLayers
          ? "All moving layers are applied."
          : "The transform is applied to the dataset.",
      };
  }
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Text type="warning" style={{ fontSize: 12 }}>
      <WarningOutlined /> {children}
    </Typography.Text>
  );
}

// Why landmarks or pairs are not used for the transform, or why it may be wrong.
function getWarnings(pairs: LandmarkPair[], estimation: TransformEstimation): string[] {
  const warnings: string[] = [];
  const incompletePairs = pairs.filter((pair) => !isCompletePair(pair));
  const [firstIncompletePair] = incompletePairs;
  if (incompletePairs.length === 1 && firstIncompletePair.pairId != null) {
    const missingView =
      VIEW_NAMES[firstIncompletePair.landmarks.fixed == null ? "fixed" : "moving"];
    warnings.push(
      `${getLandmarkTreeName(firstIncompletePair.pairId)} has no partner in the ${missingView} view, so it is not used yet.`,
    );
  } else if (incompletePairs.length > 0) {
    warnings.push(
      `${incompletePairs.length} landmarks without a partner are not used for the transform yet.`,
    );
  }
  if ("errorMessage" in estimation) {
    // With too few pairs, the status line already says why.
    const completePairCount = pairs.length - incompletePairs.length;
    if (completePairCount >= MIN_LANDMARK_PAIR_COUNT) {
      warnings.push(estimation.errorMessage);
    }
  } else if (estimation.usedCopiesInNextSlice) {
    warnings.push(
      "The landmarks lie in one plane, so the transform assumes that the layers are only shifted against each other along z.",
    );
  }
  return warnings;
}

/** The state of the transform of the active moving layer: whether there is one, how good it
 * is, what to do next, and warnings.
 */
export function TransformStatusCard({
  pairs,
  estimation,
  meanResidual,
  voxelSize,
  nextStep,
  onSelectPair,
  onSelectMovingLayer,
}: {
  pairs: LandmarkPair[];
  // The transform estimation of the active moving layer.
  estimation: TransformEstimation;
  meanResidual: number | null;
  voxelSize: VoxelSize;
  nextStep: NextStep | null;
  onSelectPair: (pair: LandmarkPair) => void;
  onSelectMovingLayer: (layerName: string) => void;
}) {
  const { token } = theme.useToken();
  const completePairCount = pairs.filter(isCompletePair).length;
  const nextStepContent =
    nextStep != null ? getNextStepContent(nextStep, onSelectPair, onSelectMovingLayer) : null;
  const warnings = getWarnings(pairs, estimation);
  const hasTransform = !("errorMessage" in estimation);

  return (
    <Flex
      vertical
      gap={6}
      style={{
        margin: `0 ${token.marginSM}px`,
        padding: `10px ${token.paddingSM}px`,
        borderRadius: token.borderRadiusLG,
        background: token.colorFillQuaternary,
      }}
    >
      <Flex align="center" gap={8} wrap>
        {hasTransform ? (
          <Badge
            status="success"
            text={<Typography.Text strong>Transform estimated</Typography.Text>}
          />
        ) : (
          <Badge
            status="default"
            text={<Typography.Text strong>No transform yet</Typography.Text>}
          />
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {hasTransform
            ? `${completePairCount} ${pluralize("pair", completePairCount)} used${
                meanResidual != null
                  ? ` · mean error ${formatResidual(meanResidual, voxelSize)}`
                  : ""
              }`
            : `${completePairCount} of at least ${MIN_LANDMARK_PAIR_COUNT} pairs`}
        </Typography.Text>
      </Flex>
      {nextStepContent != null ? (
        <Flex gap={8} align="baseline">
          <BulbOutlined style={{ color: token.colorPrimary }} />
          <Typography.Text>
            <Typography.Text strong>Next:</Typography.Text> {nextStepContent.text}
            {nextStepContent.action != null ? (
              <Button
                type="link"
                size="small"
                onClick={nextStepContent.action.onClick}
                style={{ height: "auto", padding: "0 0 0 4px" }}
              >
                {nextStepContent.action.label} →
              </Button>
            ) : null}
          </Typography.Text>
        </Flex>
      ) : null}
      {warnings.map((warning) => (
        <Warning key={warning}>{warning}</Warning>
      ))}
    </Flex>
  );
}
