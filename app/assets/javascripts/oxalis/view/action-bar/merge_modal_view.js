// @flow
import React, { Component } from "react";
import { connect } from "react-redux";
import type { OxalisState } from "oxalis/store";
import Toast from "libs/toast";
import Request from "libs/request";
import app from "app";
import { Modal, Button, Input, Upload, Select, Form } from "antd";

type AnnotationInfoType = {
  typ: string,
  id: string,
};

type TaskTypeInfoType = {
  id: string,
  label: string,
}

type MergeModalViewState = {
  taskTypes: Array<TaskTypeInfoType>,
  projects: Array<string>,
  selectedTaskType: ?string,
  selectedProject: ?string,
  selectedExplorativeAnnotation: string,
  selectedNML: ?AnnotationInfoType,
};

type UploadInfoType<T> = {
  file: {
    status: "uploading" | "error",
  } | {
    status: "done",
    response: T,
  },
};

class MergeModalView extends Component {
  props: {
    isVisible: boolean,
    onOk: () => void,
    tracingId: string,
    tracingType: string,
  };

  state: MergeModalViewState = {
    taskTypes: [],
    projects: [],
    selectedTaskType: null,
    selectedProject: null,
    selectedExplorativeAnnotation: "",
    selectedNML: null,
  };

  async componentWillMount(): Promise<void> {
    const taskTypes = await Request.receiveJSON("/api/taskTypes");
    this.setState({ taskTypes: taskTypes.map(taskType => ({ id: taskType.id, label: taskType.summary })) });
    const projects = await Request.receiveJSON("/api/projects");
    this.setState({ projects: projects.map(project => project.name) });
  }

  validateId(id: string) {
    return Request.receiveJSON(`/api/find?q=${id}&type=id`);
  }

  async merge(url: string) {
    // const readOnly = document.getElementById("checkbox-read-only").checked;
    const annotation = await Request.receiveJSON(`${url}/false`);
    Toast.message(annotation.messages);
    const redirectUrl = `/annotations/${annotation.typ}/${annotation.id}`;
    app.router.loadURL(redirectUrl);
  }

  handleChangeMergeTaskType = (taskType: string) => {
    this.setState({ selectedTaskType: taskType });
  };

  handleChangeMergeProject = (project: string) => {
    this.setState({ selectedProject: project });
  };

  handleChangeMergeExplorativeAnnotation = (event: SyntheticInputEvent) => {
    this.setState({ selectedExplorativeAnnotation: event.target.value });
  };

  handleChangeNML = (info: UploadInfoType<{ annotation: AnnotationInfoType, messages: Array<any> }>) => {
    if (info.file.status !== "uploading") {
      console.log(info.file);
    }
    if (info.file.status === "done") {
      const { annotation } = info.file.response;
      Toast.message(info.file.response.messages);
      const url = `/annotations/${annotation.typ}/${annotation.id}/merge/` +
        `${this.props.tracingType}/${this.props.tracingId}`;
      this.merge(url);
    }
  };

  handleMergeTaskType = (event: SyntheticEvent) => {
    event.preventDefault();
    const { selectedTaskType } = this.state;
    if (selectedTaskType != null) {
      const url = `/annotations/CompoundTaskType/${selectedTaskType}/` +
        `merge/${this.props.tracingType}/${this.props.tracingId}`;
      this.merge(url);
    }
  };

  handleMergeProject = (event: SyntheticEvent) => {
    event.preventDefault();
    const { selectedProject } = this.state;
    if (selectedProject != null) {
      const url = `/annotations/CompoundProject/${selectedProject}/merge/` +
        `${this.props.tracingType}/${this.props.tracingId}`;
      this.merge(url);
    }
  };

  handleMergeExplorativeAnnotation = async (event: SyntheticEvent) => {
    event.preventDefault();
    const { selectedExplorativeAnnotation } = this.state;

    if (selectedExplorativeAnnotation != null) {
      await this.validateId(selectedExplorativeAnnotation);
      const url = `/annotations/Explorational/${selectedExplorativeAnnotation}/merge/` +
        `${this.props.tracingType}/${this.props.tracingId}`;
      this.merge(url);
    }
  };

  render() {
    return (
      <Modal
        title="Merge"
        visible={this.props.isVisible}
        onOk={this.props.onOk}
        onCancel={this.props.onOk}
      >
        <Form layout="inline" onSubmit={this.handleMergeTaskType}>
          <Form.Item label="Task Type">
            <Select value={this.state.selectedTaskType} style={{ width: 200 }} onChange={this.handleChangeMergeTaskType}>
              {
                this.state.taskTypes.map(taskType =>
                  <Select.Option value={taskType.id}>{taskType.label}</Select.Option>)
              }
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" size="default">Merge</Button>
          </Form.Item>
        </Form>

        <Form layout="inline" onSubmit={this.handleMergeProject}>
          <Form.Item label="Project">
            <Select value={this.state.selectedProject} style={{ width: 200 }} onChange={this.handleChangeMergeProject}>
              {
                this.state.projects.map(project =>
                  <Select.Option value={project}>{project}</Select.Option>)
              }
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" size="default">Merge</Button>
          </Form.Item>
        </Form>

        <Form layout="inline">
          <Form.Item label="NML">
            <Upload
              name="nmlFile"
              action={jsRoutes.controllers.AnnotationIOController.upload().url}
              headers={{ authorization: "authorization-text" }}
              onChange={this.handleChangeNML}
              value={this.state.selectedNML}
              accept=".nml"
              showUploadList={false}
            >
              <Button icon="upload" style={{ width: 200 }}>Upload NML and merge</Button>
            </Upload>
          </Form.Item>
        </Form>

        <Form layout="inline" onSubmit={this.handleMergeExplorativeAnnotation}>
          <Form.Item label="Explorative Annotation">
            <Input
              value={this.state.selectedExplorativeAnnotation}
              style={{ width: 200 }}
              onChange={this.handleChangeMergeExplorativeAnnotation}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" size="default">Merge</Button>
          </Form.Item>
        </Form>
        <hr />
        <div>
          The merged tracing will be saved as a new explorative tracing.
        </div>
      </Modal>
    );
  }
}

// <hr>
// <div class="checkbox hidden">
//   <label>
//     <input type="checkbox" id="checkbox-read-only">
//     The merged tracing will be read-only.
//   </label>
// </div>

function mapStateToProps(state: OxalisState) {
  return {
    tracingId: state.skeletonTracing.id,
    tracingType: state.skeletonTracing.tracingType,
  };
}

export default connect()(MergeModalView);
