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
import { createContext, useContext } from "react";
import { Link } from "react-router";
import type { APIAnnotation, APITaskWithAnnotation, APIUser } from "types/api_types";
import { getVolumeDescriptors } from "viewer/model/accessors/annotation_accessor";

export type TaskActionsContextValue = {
  activeUser: APIUser;
  // Names of the teams the active user manages, computed once for all task cards.
  managedTeamNames: Set<string>;
  isAdminView: boolean;
  onTransfer: (annotationId: string) => void;
  onReset: (annotation: APIAnnotation) => void;
  onCancel: (annotation: APIAnnotation) => void;
  onFinish: (task: APITaskWithAnnotation) => void;
};

export const TaskActionsContext = createContext<TaskActionsContextValue | null>(null);

export function TaskActions({
  task,
  orientation,
}: {
  task: APITaskWithAnnotation;
  orientation: SpaceProps["orientation"];
}) {
  const context = useContext(TaskActionsContext);
  if (context == null) throw new Error("TaskActions must be rendered inside TaskActionsContext.");
  const { activeUser, managedTeamNames, isAdminView, onTransfer, onReset, onCancel, onFinish } =
    context;
  const { annotation } = task;
  const isAdmin = activeUser.isAdmin || managedTeamNames.has(task.team);
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
