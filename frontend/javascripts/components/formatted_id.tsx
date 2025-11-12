import FastTooltip from "./fast_tooltip";

import { formatShortId } from "libs/format_utils";
import Toast from "libs/toast";

import { CopyOutlined } from "@ant-design/icons";

export default function FormattedId({
  id,
}: {
  id: string;
}) {
  const _shortId = formatShortId(id);

  return (
    <FastTooltip title={`Click to copy long ID ${id}`}>
      <div
        onClick={() => {
          navigator.clipboard.writeText(id);
          Toast.success("Copied ID to clipboard.");
        }}
        style={{ cursor: "pointer" }}
      >
        <CopyOutlined /> {`…${_shortId}`}
      </div>
    </FastTooltip>
  );
}
