// @flow
/* eslint-disable jsx-a11y/href-no-hash */
import { Dropdown, Menu, Icon, Modal } from "antd";
import React from "react";
import moment from "moment";
import FormatUtils from "libs/format_utils";
import {
  getAnnotationsForTask,
  reOpenAnnotation,
  finishAnnotation,
  resetAnnotation,
  deleteAnnotation,
} from "admin/admin_rest_api";
import messages from "messages";
import TransferTaskModal from "dashboard/views/transfer_task_modal";
import type { APITaskType, APIAnnotationType } from "admin/api_flow_types";

const { Item } = Menu;
const { confirm } = Modal;

type Props = {
  task: APITaskType,
};

type State = {
  isTransferModalVisible: boolean,
  annotations: Array<APIAnnotationType>,
  currentAnnotation: ?APIAnnotationType,
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

  deleteAnnotation = (annotation: APIAnnotationType) => {
    confirm({
      title: messages["annotation.delete"],
      onOk: () =>
        deleteAnnotation(annotation.id).then(() =>
          this.setState({
            annotations: this.state.annotations.filter(a => a.id !== annotation.id),
          }),
        ),
    });
  };

  finishAnnotation = async (annotation: APIAnnotationType) => {
    const updatedAnnotation = await finishAnnotation(annotation.id);
    this.updateAnnotationState(updatedAnnotation);
  };

  reOpenAnnotation = async (annotation: APIAnnotationType) => {
    const updatedAnnotation = await reOpenAnnotation(annotation.id);
    this.updateAnnotationState(updatedAnnotation);
  };

  updateAnnotationState = (updatedAnnotation: APIAnnotationType) => {
    this.setState({
      isTransferModalVisible: false,
      annotations: this.state.annotations.map(
        a => (a.id === updatedAnnotation.id ? updatedAnnotation : a),
      ),
    });
  };

  getDropdownMenu(annotation: APIAnnotationType) {
    const label = annotation.state.isFinished ? (
      <>
        <Icon type="eye-o" />View
      </>
    ) : (
      <>
        <Icon type="play-circle-o" />Trace
      </>
    );

    return (
      <Menu>
        <Item key={`${annotation.id}-view`}>
          <a href={`/annotations/Task/${annotation.id}`}>{label}</a>
        </Item>

        <Item key={`${annotation.id}-transfer`}>
          <span
            onClick={() =>
              this.setState({ currentAnnotation: annotation, isTransferModalVisible: true })
            }
          >
            <Icon type="team" />Transfer
          </span>
        </Item>
        <Item key={`${annotation.id}-download`}>
          <a href={`/annotations/Task/${annotation.id}/download`}>
            <Icon type="download" />Download
          </a>
        </Item>
        <Item key={`${annotation.id}-reset`}>
          <span onClick={() => resetAnnotation(annotation.id)}>
            <Icon type="rollback" />Reset
          </span>
        </Item>
        <Item key={`${annotation.id}-delete`}>
          <span onClick={() => this.deleteAnnotation(annotation)}>
            <Icon type="delete" />Cancel
          </span>
        </Item>
        {annotation.state.isFinished ? (
          <Item key={`${annotation.id}-reopen`}>
            <span onClick={() => this.reOpenAnnotation(annotation)}>
              <Icon type="folder-open" />Reopen
            </span>
          </Item>
        ) : (
          <Item key={`${annotation.id}-finish`}>
            <span onClick={() => this.finishAnnotation(annotation)}>
              <Icon type="check-circle-o" />Finish
            </span>
          </Item>
        )}
      </Menu>
    );
  }

  render() {
    return (
      <div>
        <table>
          <tbody>
            {this.state.annotations.map((annotation: APIAnnotationType) => {
              const userString = annotation.user
                ? `${annotation.user.firstName} ${annotation.user.lastName} ( ${
                    annotation.user.email
                  } )`
                : "<no user>";
              return (
                <tr key={`${annotation.id}-tr`}>
                  <td>{userString}</td>
                  <td>{moment(annotation.modified).format("YYYY-MM-DD HH:SS")}</td>
                  <td>
                    <span>
                      <Icon type="check-circle-o" />
                      {`${annotation.state.isFinished ? "Finished" : "In Progress"}`}
                    </span>
                    <br />
                    <span>
                      <Icon type="clock-circle-o" />
                      {annotation.tracingTime
                        ? FormatUtils.formatSeconds(annotation.tracingTime / 1000)
                        : 0}
                    </span>
                  </td>
                  <td className="nowrap">
                    <Dropdown overlay={this.getDropdownMenu(annotation)} trigger={["click"]}>
                      <a className="ant-dropdown-link" href="#">
                        Actions <Icon type="down" />
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

export default TaskAnnotationView;
