import { CopyOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { copyToClipboard } from "libs/clipboard";

export function CopyIconWithTooltip({ value, title }: { value: string | number; title: string }) {
  return (
    <FastTooltip title={title}>
      <CopyOutlined onClick={() => copyToClipboard(value.toString(), undefined, true)} />
    </FastTooltip>
  );
}
