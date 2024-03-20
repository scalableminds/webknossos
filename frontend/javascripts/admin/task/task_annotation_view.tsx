import { Dropdown, MenuProps, Modal, Tooltip } from "antd";
import {
  EyeOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  TeamOutlined,
  RollbackOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  DownloadOutlined,
  ClockCircleOutlined,
  DownOutlined,
} from "@ant-design/icons";
import { connect } from "react-redux";
import React from "react";
import type { APIUser, APITask, APIAnnotation } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { formatSeconds } from "libs/format_utils";
import { AsyncLink } from "components/async_clickables";
import {
  getAnnotationsForTask,
  reOpenAnnotation,
  finishAnnotation,
  resetAnnotation,
  deleteAnnotation,
  downloadAnnotation,
} from "admin/admin_rest_api";
import FormattedDate from "components/formatted_date";
import Toast from "libs/toast";
import TransferTaskModal from "dashboard/transfer_task_modal";
import messages from "messages";
import { getVolumeDescriptors } from "oxalis/model/accessors/volumetracing_accessor";
const { confirm } = Modal;
type OwnProps = {
  task: APITask;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
};
type Props = OwnProps & StateProps;
type State = {
  isTransferModalOpen: boolean;
  annotations: Array<APIAnnotation>;
  currentAnnotation: APIAnnotation | null | undefined;
};

class TaskAnnotationView extends React.PureComponent<Props, State> {
  state: State = {
    currentAnnotation: null,
    isTransferModalOpen: false,
    annotations: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const annotations = await getAnnotationsForTask(this.props.task.id);
    this.setState({
      annotations,
    });
  }

  deleteAnnotation = (annotation: APIAnnotation) => {
    confirm({
      title: messages["annotation.delete"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: () =>
        deleteAnnotation(annotation.id, annotation.typ).then(() =>
          this.setState((prevState) => ({
            annotations: prevState.annotations.filter((a) => a.id !== annotation.id),
          })),
        ),
    });
  };

  resetAnnotation = async (annotation: APIAnnotation) => {
    await resetAnnotation(annotation.id, annotation.typ);
    Toast.success(messages["annotation.reset_success"]);
  };

  finishAnnotation = async (annotation: APIAnnotation) => {
    const updatedAnnotation = await finishAnnotation(annotation.id, annotation.typ);
    this.updateAnnotationState(updatedAnnotation);
  };

  reOpenAnnotation = async (annotation: APIAnnotation) => {
    const updatedAnnotation = await reOpenAnnotation(annotation.id, annotation.typ);
    this.updateAnnotationState(updatedAnnotation);
  };

  updateAnnotationState = (updatedAnnotation: APIAnnotation) => {
    this.setState((prevState) => ({
      isTransferModalOpen: false,
      annotations: prevState.annotations.map((a) =>
        a.id === updatedAnnotation.id ? updatedAnnotation : a,
      ),
    }));
  };

  getViewOrOpenLabel(annotation: APIAnnotation) {
    const iconClassName = "icon-margin-right";
    let doesAnnotationNotBelongToActiveUser = true;

    if (annotation.owner && this.props.activeUser) {
      doesAnnotationNotBelongToActiveUser = annotation.owner.id !== this.props.activeUser.id;
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

  getDropdownMenu(annotation: APIAnnotation): MenuProps {
    return {
      items: [
        {
          key: `${annotation.id}-transfer`,
          onClick: () =>
            this.setState({
              currentAnnotation: annotation,
              isTransferModalOpen: true,
            }),
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
                return downloadAnnotation(annotation.id, "Task", isVolumeIncluded);
              }}
            >
              Download
            </AsyncLink>
          ),
        },
        {
          key: `${annotation.id}-reset`,
          onClick: () => this.resetAnnotation(annotation),
          icon: <RollbackOutlined />,
          label: (
            <Tooltip title={messages["task.tooltip_explain_reset"]} placement="left">
              Reset
            </Tooltip>
          ),
        },
        {
          key: `${annotation.id}-delete`,
          onClick: () => this.deleteAnnotation(annotation),
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
              onClick: () => this.reOpenAnnotation(annotation),
              icon: <FolderOpenOutlined />,
              label: "Reopen",
            }
          : {
              key: `${annotation.id}-finish`,
              onClick: () => this.finishAnnotation(annotation),
              icon: <CheckCircleOutlined />,
              label: "Finish",
            },
      ],
    };
  }

  render() {
    if (!this.state.annotations || this.state.annotations.length <= 0) {
      return <p> No users are assigned to this task, yet.</p>;
    }

    return (
      <div>
        <table>
          <tbody className="task-annotation-view">
            {this.state.annotations.map((annotation: APIAnnotation) => {
              const userString = annotation.owner
                ? `${annotation.owner.firstName} ${annotation.owner.lastName} ( ${annotation.owner.email} )`
                : "<no user>";
              return (
                <tr key={`${annotation.id}-tr`}>
                  <td>{userString}</td>
                  <td>{this.getViewOrOpenLabel(annotation)}</td>
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
                    <Dropdown menu={this.getDropdownMenu(annotation)} trigger={["click"]}>
                      <a className="ant-dropdown-link" href="#">
                        Actions <DownOutlined />
                      </a>
                    </Dropdown>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {this.state.currentAnnotation?.owner ? (
          <TransferTaskModal
            isOpen={this.state.isTransferModalOpen}
            annotationId={this.state.currentAnnotation.id}
            onCancel={() =>
              this.setState({
                isTransferModalOpen: false,
              })
            }
            onChange={this.updateAnnotationState}
          />
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(TaskAnnotationView);
