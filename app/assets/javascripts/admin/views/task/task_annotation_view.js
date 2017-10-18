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
    return (
      <Menu>
        <Item key={`${annotation.id}-view`}>
          <a href={`/annotations/Task/${annotation.id}`}>
            <i className="fa fa-random" />
            {annotation.state.isFinished ? "View" : "Trace"}
          </a>
        </Item>

        <Item key={`${annotation.id}-transfer`}>
          <span
            onClick={() =>
              this.setState({ currentAnnotation: annotation, isTransferModalVisible: true })}
          >
            <i className="fa fa-share" />
            Transfer
          </span>
        </Item>
        <Item key={`${annotation.id}-download`}>
          <a href={`/annotations/Task/${annotation.id}/download`}>
            <i className="fa fa-download" />
            Download
          </a>
        </Item>
        <Item key={`${annotation.id}-reset`}>
          <span onClick={() => resetAnnotation(annotation.id)}>
            <i className="fa fa-undo" />
            Reset
          </span>
        </Item>
        <Item key={`${annotation.id}-delete`}>
          <span onClick={() => this.deleteAnnotation(annotation)}>
            <i className="fa fa-trash-o" />
            Delete
          </span>
        </Item>
        {annotation.state.isFinished ? (
          <Item key={`${annotation.id}-reopen`}>
            <span onClick={() => this.reOpenAnnotation(annotation)}>
              <i className="fa fa-share" />
              Reopen
            </span>
          </Item>
        ) : (
          <Item key={`${annotation.id}-finish`}>
            <span onClick={() => this.finishAnnotation(annotation)}>
              <i className="fa fa-check-circle-o" />
              Finish
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
            {this.state.annotations.map((annotation: APIAnnotationType) => (
              <tr key={`${annotation.id}-tr`}>
                <td>{`${annotation.user.firstName} ${annotation.user.lastName} ( ${annotation.user
                  .email} )`}</td>
                <td>{moment(annotation.modified).format("YYYY-MM-DD HH:SS")}</td>
                <td>
                  <span>
                    <i className="fa fa-check-circle-o" />
                    {annotation.stateLabel}
                  </span>
                  <br />
                  <span>
                    <i className="fa fa-clock-o" />
                    {annotation.tracingTime ? (
                      FormatUtils.formatSeconds(annotation.tracingTime / 1000)
                    ) : (
                      0
                    )}
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
            ))}
          </tbody>
        </table>
        {this.state.currentAnnotation ? (
          <TransferTaskModal
            visible={this.state.isTransferModalVisible}
            annotationId={this.state.currentAnnotation.id}
            onCancel={() => this.setState({ isTransferModalVisible: false })}
            onChange={this.updateAnnotationState}
            userID={this.state.currentAnnotation.user.id}
          />
        ) : null}
      </div>
    );
  }
}

export default TaskAnnotationView;
