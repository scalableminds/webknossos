// Unified datasets prototype: shown in the action bar while the user may not change the dataset's
// annotation layers.
import { CopyOutlined, EyeOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Tooltip } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import { setCopyDatasetModalVisibilityAction } from "viewer/model/actions/ui_actions";

export default function UnifiedReadOnlyBanner() {
  const dispatch = useDispatch();
  const isLoggedIn = useWkSelector((state) => state.activeUser != null);

  return (
    <Space size="small">
      <Tooltip title="You can look at this dataset, but not change its annotation layers.">
        <Tag icon={<EyeOutlined />} style={{ marginInlineEnd: 0 }}>
          Read-only
        </Tag>
      </Tooltip>
      <Tooltip
        title={
          isLoggedIn ? "Make your own copy of this dataset to edit it." : "Log in to make a copy."
        }
      >
        <Button
          type="primary"
          icon={<CopyOutlined />}
          disabled={!isLoggedIn}
          onClick={() => dispatch(setCopyDatasetModalVisibilityAction(true))}
        >
          Copy to edit
        </Button>
      </Tooltip>
    </Space>
  );
}
