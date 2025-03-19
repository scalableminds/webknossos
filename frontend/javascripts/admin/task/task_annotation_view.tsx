import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  RollbackOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  deleteAnnotation as deleteAnnotationAPI,
  downloadAnnotation as downloadAnnotationAPI,
  finishAnnotation as finishAnnotationAPI,
  reOpenAnnotation as reOpenAnnotationAPI,
  resetAnnotation as resetAnnotationAPI,
} from "admin/admin_rest_api";
import { getAnnotationsForTask } from "admin/api/tasks";
import { App, Dropdown, type MenuProps, Tooltip } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import TransferTaskModal from "dashboard/transfer_task_modal";
import { formatSeconds } from "libs/format_utils";
import Toast from "libs/toast";
import messages from "messages";
import { getVolumeDescriptors } from "oxalis/model/accessors/volumetracing_accessor";
import type { OxalisState } from "oxalis/store";
import { useEffect, useState } from "react";
import { connect } from "react-redux";
import type { APIAnnotation, APITask, APIUser } from "types/api_flow_types";

type OwnProps = {
  task: APITask;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
};
type Props = OwnProps & StateProps;

function TaskAnnotationView({ task, activeUser }: Props) {
  const { modal } = App.useApp();

  const [currentAnnotation, setCurrentAnnotation] = useState<APIAnnotation | undefined>(undefined);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [annotations, setAnnotations] = useState<APIAnnotation[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const annotations = await getAnnotationsForTask(task.id);
    setAnnotations(annotations);
  }

  function deleteAnnotation(annotation: APIAnnotation) {
    modal.confirm({
      title: messages["annotation.delete"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: () =>
        deleteAnnotationAPI(annotation.id, annotation.typ).then(() =>
          setAnnotations(annotations.filter((a) => a.id !== annotation.id)),
        ),
    });
  }

  async function resetAnnotation(annotation: APIAnnotation) {
    await resetAnnotationAPI(annotation.id, annotation.typ);
    Toast.success(messages["annotation.reset_success"]);
  }

  async function finishAnnotation(annotation: APIAnnotation) {
    const updatedAnnotation = await finishAnnotationAPI(annotation.id, annotation.typ);
    updateAnnotationState(updatedAnnotation);
  }

  async function reOpenAnnotation(annotation: APIAnnotation) {
    const updatedAnnotation = await reOpenAnnotationAPI(annotation.id, annotation.typ);
    updateAnnotationState(updatedAnnotation);
  }

  function updateAnnotationState(updatedAnnotation: APIAnnotation) {
    setIsTransferModalOpen(false);
    setAnnotations(annotations.map((a) => (a.id === updatedAnnotation.id ? updatedAnnotation : a)));
  }

  function getViewOrOpenLabel(annotation: APIAnnotation) {
    const iconClassName = "icon-margin-right";
    let doesAnnotationNotBelongToActiveUser = true;

    if (annotation.owner && activeUser) {
      doesAnnotationNotBelongToActiveUser = annotation.owner.id !== activeUser.id;
    }
    const label =
      annotation.state === "Finished" || doesAnnotationNotBelongToActiveUser ? "View" : "Open";
    const icon =
      annotation.state === "Finished" || doesAnnotationNotBelongToActiveUser ? (
        <EyeOutlined className={iconClassName} />
      ) : (
        <PlayCircleOutlined className={iconClassName} />
      );

    return (
      <a href={`/annotations/Task/${annotation.id}`}>
        {icon}
        {label}
      </a>
    );
  }

  function getDropdownMenu(annotation: APIAnnotation): MenuProps {
    return {
      items: [
        {
          key: `${annotation.id}-transfer`,
          onClick: () => {
            setCurrentAnnotation(annotation);
            setIsTransferModalOpen(true);
          },
          icon: <TeamOutlined />,
          label: "Transfer",
        },
        {
          key: `${annotation.id}-download`,
          icon: <DownloadOutlined />,
          label: (
            <AsyncLink
              href="#"
              onClick={() => {
                const isVolumeIncluded = getVolumeDescriptors(annotation).length > 0;
                return downloadAnnotationAPI(annotation.id, "Task", isVolumeIncluded);
              }}
            >
              Download
            </AsyncLink>
          ),
        },
        {
          key: `${annotation.id}-reset`,
          onClick: () => resetAnnotation(annotation),
          icon: <RollbackOutlined />,
          label: (
            <Tooltip title={messages["task.tooltip_explain_reset"]} placement="left">
              Reset
            </Tooltip>
          ),
        },
        {
          key: `${annotation.id}-delete`,
          onClick: () => deleteAnnotation(annotation),
          icon: <DeleteOutlined />,
          label: (
            <Tooltip title={messages["task.tooltip_explain_reset_cancel"]} placement="left">
              Reset and Cancel
            </Tooltip>
          ),
        },
        annotation.state === "Finished"
          ? {
              key: `${annotation.id}-reopen`,
              onClick: () => reOpenAnnotation(annotation),
              icon: <FolderOpenOutlined />,
              label: "Reopen",
            }
          : {
              key: `${annotation.id}-finish`,
              onClick: () => finishAnnotation(annotation),
              icon: <CheckCircleOutlined />,
              label: "Finish",
            },
      ],
    };
  }

  if (!annotations || annotations.length <= 0) {
    return <p> No users are assigned to this task, yet.</p>;
  }

  return (
    <div>
      <table>
        <tbody>
          {annotations.map((annotation: APIAnnotation) => {
            const userString = annotation.owner
              ? `${annotation.owner.firstName} ${annotation.owner.lastName} ( ${annotation.owner.email} )`
              : "<no user>";
            return (
              <tr key={`${annotation.id}-tr`}>
                <td>{userString}</td>
                <td>
                  <FormattedDate timestamp={annotation.modified} />
                </td>
                <td>
                  <span>
                    <CheckCircleOutlined className="icon-margin-right" />
                    {`${annotation.state === "Finished" ? "Finished" : "In Progress"}`}
                  </span>
                  <br />
                  <span>
                    <ClockCircleOutlined className="icon-margin-right" />
                    {annotation.tracingTime != null
                      ? formatSeconds(annotation.tracingTime / 1000)
                      : 0}
                  </span>
                </td>
                <td className="nowrap">
                  <div>{getViewOrOpenLabel(annotation)}</div>
                  <Dropdown menu={getDropdownMenu(annotation)} trigger={["click"]}>
                    <a className="ant-dropdown-link">
                      Actions <DownOutlined />
                    </a>
                  </Dropdown>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {currentAnnotation?.owner ? (
        <TransferTaskModal
          isOpen={isTransferModalOpen}
          annotationId={currentAnnotation.id}
          onCancel={() => setIsTransferModalOpen(false)}
          onChange={updateAnnotationState}
        />
      ) : null}
    </div>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(TaskAnnotationView);
