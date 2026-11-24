import FastTooltip from "components/fast_tooltip";
import { formatCountToDataAmountUnit } from "libs/format_utils";

export const ZeroStorageReasonList = (
  <ul>
    <li>The storage hasn't been scanned yet or scanning is disabled</li>
    <li>The data is streamed from external sources</li>
    <li>The data layers are already counted in other (linked) datasets</li>
    <li>The dataset belongs to another organization</li>
    <li>The dataset is empty</li>
  </ul>
);

// Formatted storage amount with a tooltip. Shows the exact byte count, or, for zero,
// the possible reasons why no storage is counted.
export function UsedStorageAmount({ bytes }: { bytes: number }) {
  const formattedBytes = formatCountToDataAmountUnit(bytes, true);
  return bytes > 0 ? (
    <FastTooltip title={`${new Intl.NumberFormat().format(bytes)} bytes`}>
      {formattedBytes}
    </FastTooltip>
  ) : (
    <FastTooltip
      dynamicRenderer={() => (
        <>
          The storage may be zero because:
          {ZeroStorageReasonList}
        </>
      )}
    >
      {formattedBytes}
    </FastTooltip>
  );
}
