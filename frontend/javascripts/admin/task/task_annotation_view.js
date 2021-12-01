// @flow
import { Dropdown, Menu, Modal } from "antd";
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
  downloadNml,
} from "admin/admin_rest_api";
import FormattedDate from "components/formatted_date";
import Toast from "libs/toast";
import TransferTaskModal from "dashboard/transfer_task_modal";
import messages from "messages";
import { getVolumeDescriptors } from "oxalis/model/accessors/volumetracing_accessor";

const { Item } = Menu;
const { confirm } = Modal;

type OwnProps = {|
  task: APITask,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isTransferModalVisible: boolean,
  annotations: Array<APIAnnotation>,
  currentAnnotation: ?APIAnnotation,
};

class TaskAnnotationView extends React.PureComponent<Props, State> {
  state = {
    currentAnnotation: null,
    isTransferModalVisible: false,
    annotations: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const annotations = await getAnnotationsForTask(this.props.task.id);
    this.setState({ annotations });
  }

  deleteAnnotation = (annotation: APIAnnotation) => {
    confirm({
      title: messages["annotation.delete"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: () =>
        deleteAnnotation(annotation.id, annotation.typ).then(() =>
          this.setState(prevState => ({
            annotations: prevState.annotations.filter(a => a.id !== annotation.id),
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
    this.setState(prevState => ({
      isTransferModalVisible: false,
      annotations: prevState.annotations.map(a =>
        a.id === updatedAnnotation.id ? updatedAnnotation : a,
      ),
    }));
  };

  getDropdownMenu(annotation: APIAnnotation) {
    let doesAnnotationNotBelongToActiveUser = true;

    if (annotation.user && this.props.activeUser) {
      doesAnnotationNotBelongToActiveUser = annotation.user.id !== this.props.activeUser.id;
    }

    const label =
      annotation.state === "Finished" || doesAnnotationNotBelongToActiveUser ? (
        <React.Fragment>
          <EyeOutlined />
          View
        </React.Fragment>
      ) : (
        <React.Fragment>
          <PlayCircleOutlined />
          Trace
        </React.Fragment>
      );

    return (
      <Menu>
        <Item key={`${annotation.id}-view`}>
          <a href={`/annotations/Task/${annotation.id}`}>{label}</a>
        </Item>

        <Item
          key={`${annotation.id}-transfer`}
          onClick={() =>
            this.setState({ currentAnnotation: annotation, isTransferModalVisible: true })
          }
        >
          <TeamOutlined />
          Transfer
        </Item>
        <Item key={`${annotation.id}-download`}>
          <AsyncLink
            href="#"
            onClick={() => {
              const isVolumeIncluded = getVolumeDescriptors(annotation).length > 0;
              return downloadNml(annotation.id, "Task", isVolumeIncluded);
            }}
            icon={<DownloadOutlined />}
          >
            Download
          </AsyncLink>
        </Item>
        <Item key={`${annotation.id}-reset`} onClick={() => this.resetAnnotation(annotation)}>
          <RollbackOutlined />
          Reset
        </Item>
        <Item key={`${annotation.id}-delete`} onClick={() => this.deleteAnnotation(annotation)}>
          <DeleteOutlined />
          Reset and Cancel
        </Item>
        {annotation.state === "Finished" ? (
          <Item key={`${annotation.id}-reopen`} onClick={() => this.reOpenAnnotation(annotation)}>
            <FolderOpenOutlined />
            Reopen
          </Item>
        ) : (
          <Item key={`${annotation.id}-finish`} onClick={() => this.finishAnnotation(annotation)}>
            <CheckCircleOutlined />
            Finish
          </Item>
        )}
      </Menu>
    );
  }

  render() {
    if (!this.state.annotations || this.state.annotations.length <= 0) {
      return <p> No users are assigned to this task, yet.</p>;
    }
    return (
      <div>
        <table>
          <tbody>
            {this.state.annotations.map((annotation: APIAnnotation) => {
              const userString = annotation.user
                ? `${annotation.user.firstName} ${annotation.user.lastName} ( ${
                    annotation.user.email
                  } )`
                : "<no user>";
              return (
                <tr key={`${annotation.id}-tr`}>
                  <td>{userString}</td>
                  <td>
                    <FormattedDate timestamp={annotation.modified} />
                  </td>
                  <td>
                    <span>
                      <CheckCircleOutlined />
                      {`${annotation.state === "Finished" ? "Finished" : "In Progress"}`}
                    </span>
                    <br />
                    <span>
                      <ClockCircleOutlined />
                      {annotation.tracingTime != null
                        ? formatSeconds(annotation.tracingTime / 1000)
                        : 0}
                    </span>
                  </td>
                  <td className="nowrap">
                    <Dropdown overlay={this.getDropdownMenu(annotation)} trigger={["click"]}>
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
        {this.state.currentAnnotation && this.state.currentAnnotation.user ? (
          <TransferTaskModal
            visible={this.state.isTransferModalVisible}
            annotationId={this.state.currentAnnotation.id}
            onCancel={() => this.setState({ isTransferModalVisible: false })}
            onChange={this.updateAnnotationState}
            userId={this.state.currentAnnotation.user.id}
          />
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(TaskAnnotationView);
