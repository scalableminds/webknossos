import { CopyOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { copyToClipboard } from "libs/clipboard";
import { formatNumberToLength } from "libs/format_utils";
import type { UnitShort } from "viewer/constants";

/*
 * Renders a rounded, human-readable length followed by a copy icon.
 * Clicking the icon copies the precise, unrounded length (in the dataset's base unit)
 * as a plain number so that it can be pasted into spreadsheets etc.
 */
export function CopyableLength({ length, unit }: { length: number; unit: UnitShort }) {
  const preciseLength = String(length);
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {formatNumberToLength(length, unit)}
      <FastTooltip title={`Copy precise length in ${unit} to clipboard`}>
        <CopyOutlined
          aria-label="Copy precise length"
          style={{ marginLeft: 4, cursor: "pointer" }}
          onClick={() => copyToClipboard(preciseLength, `length in ${unit}`, true)}
        />
      </FastTooltip>
    </span>
  );
}
