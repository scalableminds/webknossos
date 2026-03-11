import { CopyOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import Toast from "libs/toast";

export function CopyIconWithTooltip({ value, title }: { value: string | number; title: string }) {
  return (
    <FastTooltip title={title}>
      <CopyOutlined
        onClick={async () => {
          await navigator.clipboard.writeText(value.toString());
          Toast.success(`"${value}" copied to clipboard`);
        }}
      />
    </FastTooltip>
  );
}
