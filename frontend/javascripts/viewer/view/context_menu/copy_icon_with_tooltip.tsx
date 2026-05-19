import { CopyOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { copyToClipboard } from "libs/clipboard";

export function CopyIconWithTooltip({ value, label }: { value: string | number; label: string }) {
  return (
    <FastTooltip title={`Copy ${label}`}>
      <CopyOutlined onClick={() => copyToClipboard(value.toString(), label, true)} />
    </FastTooltip>
  );
}
