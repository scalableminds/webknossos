import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { Tag } from "antd";
import { VoxelyticsRunState } from "types/api_types";

const RUN_STATE_TAGS: Record<
  VoxelyticsRunState,
  { icon: React.ReactNode; color: string; label: string }
> = {
  [VoxelyticsRunState.PENDING]: {
    icon: <ClockCircleOutlined />,
    color: "default",
    label: "pending",
  },
  [VoxelyticsRunState.SKIPPED]: {
    icon: <MinusCircleOutlined />,
    color: "default",
    label: "skipped",
  },
  [VoxelyticsRunState.RUNNING]: {
    icon: <SyncOutlined spin />,
    color: "processing",
    label: "running",
  },
  [VoxelyticsRunState.STALE]: { icon: <CloseCircleOutlined />, color: "error", label: "timed out" },
  [VoxelyticsRunState.CANCELLED]: {
    icon: <ExclamationCircleOutlined />,
    color: "error",
    label: "cancelled",
  },
  [VoxelyticsRunState.FAILED]: { icon: <CloseCircleOutlined />, color: "error", label: "failed" },
  [VoxelyticsRunState.COMPLETE]: {
    icon: <CheckCircleOutlined />,
    color: "success",
    label: "completed",
  },
};

export default function RunStateTag({ state }: { state: VoxelyticsRunState }) {
  const { icon, color, label } = RUN_STATE_TAGS[state];
  return (
    <Tag icon={icon} color={color}>
      {label}
    </Tag>
  );
}
