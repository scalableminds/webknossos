import FastTooltip from "./fast_tooltip";

import Toast from "libs/toast";

import { CopyOutlined } from "@ant-design/icons";

export default function FormattedId({
  id,
}: {
  id: string;
}) {
  const _shortId = id.slice(-6);

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
