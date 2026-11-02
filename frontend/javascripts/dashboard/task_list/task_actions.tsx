import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  RollbackOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { downloadAnnotation } from "admin/rest_api";
import { Space, type SpaceProps, Tooltip } from "antd";
import { AsyncLink } from "components/async_clickables";
import LinkButton from "components/link_button";
import messages from "messages";
import { Link } from "react-router";
import type { APIAnnotation, APITaskWithAnnotation, APIUser } from "types/api_types";
import { getVolumeDescriptors } from "viewer/model/accessors/annotation_accessor";

export function TaskActions({
  task,
  orientation,
  activeUser,
  isAdminView,
  onTransfer,
  onReset,
  onCancel,
  onFinish,
}: {
  task: APITaskWithAnnotation;
  orientation: SpaceProps["orientation"];
  activeUser: APIUser;
  isAdminView: boolean;
  onTransfer: (annotationId: string) => void;
  onReset: (annotation: APIAnnotation) => void;
  onCancel: (annotation: APIAnnotation) => void;
  onFinish: (task: APITaskWithAnnotation) => void;
}) {
  const { annotation } = task;
  const isAdmin =
    activeUser.isAdmin ||
    activeUser.teams
      .filter((team) => team.isTeamManager)
      .map((team) => team.name)
      .includes(task.team);
  const label = isAdminView ? (
    <LinkButton icon={<EyeOutlined />}>View</LinkButton>
  ) : (
    <LinkButton icon={<PlayCircleOutlined />}>Open</LinkButton>
  );
  return (
    <Space orientation={orientation} size={orientation === "vertical" ? 1 : "middle"} wrap>
      <Link to={`/annotations/${annotation.id}`}>{label}</Link>
      {isAdmin || isAdminView ? (
        <LinkButton onClick={() => onTransfer(annotation.id)} icon={<TeamOutlined />}>
          Transfer
        </LinkButton>
      ) : null}
      {isAdmin ? (
        <>
          <AsyncLink
            onClick={() => {
              const isVolumeIncluded = getVolumeDescriptors(annotation).length > 0;
              return downloadAnnotation(annotation.id, "Task", isVolumeIncluded);
            }}
            icon={<DownloadOutlined className="icon-margin-right" />}
          >
            Download
          </AsyncLink>
          <LinkButton onClick={() => onReset(annotation)} icon={<RollbackOutlined />}>
            <Tooltip title={messages["task.tooltip_explain_reset"]} placement="left">
              Reset
            </Tooltip>
          </LinkButton>
          <LinkButton onClick={() => onCancel(annotation)} icon={<DeleteOutlined />}>
            <Tooltip title={messages["task.tooltip_explain_reset_cancel"]} placement="left">
              Reset and Cancel
            </Tooltip>
          </LinkButton>
        </>
      ) : null}
      {isAdminView ? null : (
        <LinkButton onClick={() => onFinish(task)} icon={<CheckCircleOutlined />}>
          Finish
        </LinkButton>
      )}
    </Space>
  );
}
