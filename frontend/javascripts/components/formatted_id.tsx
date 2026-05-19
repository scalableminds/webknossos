import { CopyOutlined } from "@ant-design/icons";
import { Space, Typography } from "antd";
import { copyToClipboard } from "libs/clipboard";
import FastTooltip from "./fast_tooltip";

export default function FormattedId({ id }: { id: string }) {
  const _shortId = id.slice(-6);

  return (
    <FastTooltip title={`Click to copy full ID ${id}`}>
      <span onClick={() => copyToClipboard(id, "ID", true)} style={{ cursor: "pointer" }}>
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
