import { CopyOutlined } from "@ant-design/icons";
import { Space, Typography } from "antd";
import Toast from "libs/toast";
import FastTooltip from "./fast_tooltip";

export default function FormattedId({ id }: { id: string }) {
  const _shortId = id.slice(-6);

  return (
    <FastTooltip title={`Click to copy full ID ${id}`}>
      <span
        onClick={() => {
          navigator.clipboard.writeText(id);
          Toast.success("Copied ID to clipboard.");
        }}
        style={{ cursor: "pointer" }}
      >
        <Typography.Text type="secondary">
          <Space size="small">
            {`${_shortId}`}
            <CopyOutlined />
          </Space>
        </Typography.Text>
      </span>
    </FastTooltip>
  );
}
