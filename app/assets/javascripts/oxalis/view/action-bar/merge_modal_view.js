// @flow
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import type { OxalisState } from "oxalis/store";
import Toast from "libs/toast";
import Request from "libs/request";
import app from "app";
import { Modal, Button, Upload, Select, Form, Spin } from "antd";
import InputComponent from "oxalis/view/components/input_component";
import api from "oxalis/api/internal_api";

type AnnotationInfoType = {
  typ: string,
  id: string,
};

type TaskTypeInfoType = {
  id: string,
  label: string,
};

type ProjectInfoType = {
  id: string,
  label: string,
};

type Props = {
  isVisible: boolean,
  onOk: () => void,
  annotationId: string,
  tracingType: string,
};

type MergeModalViewState = {
  taskTypes: Array<TaskTypeInfoType>,
  projects: Array<ProjectInfoType>,
  selectedTaskType: ?string,
  selectedProject: ?string,
  selectedExplorativeAnnotation: string,
  selectedNML: ?AnnotationInfoType,
  isUploading: boolean,
  readOnly: boolean,
};

type UploadInfoType<T> = {
  file:
    | {
        status: "uploading",
      }
    | {
        status: "done" | "error",
        response: T,
      },
};

class MergeModalView extends PureComponent<Props, MergeModalViewState> {
  state: MergeModalViewState = {
    taskTypes: [],
    projects: [],
    selectedTaskType: null,
    selectedProject: null,
    selectedExplorativeAnnotation: "",
    selectedNML: null,
    isUploading: false,
    readOnly: false,
  };

  componentWillMount() {
    (async () => {
      const taskTypes = await Request.receiveJSON("/api/taskTypes", { doNotCatch: true });
      const projects = await Request.receiveJSON("/api/projects", { doNotCatch: true });
      this.setState({
        taskTypes: taskTypes.map(taskType => ({ id: taskType.id, label: taskType.summary })),
        projects: projects.map(project => ({ id: project.id, label: project.name })),
      });
    })();
  }

  async merge(url: string) {
    await api.tracing.save();
    const annotation = await Request.receiveJSON(url);
    Toast.messages(annotation.messages);
    const redirectUrl = `/annotations/${annotation.typ}/${annotation.id}`;
    app.router.loadURL(redirectUrl);
  }

  handleChangeMergeTaskType = (taskType: string) => {
    this.setState({ selectedTaskType: taskType });
  };

  handleChangeMergeProject = (project: string) => {
    this.setState({ selectedProject: project });
  };

  handleChangeMergeExplorativeAnnotation = (event: SyntheticInputEvent<>) => {
    this.setState({ selectedExplorativeAnnotation: event.target.value });
  };

  handleChangeNML = (
    info: UploadInfoType<{ annotation: AnnotationInfoType, messages: Array<any> }>,
  ) => {
    if (info.file.status === "done") {
      const { annotation } = info.file.response;
      Toast.messages(info.file.response.messages);
      this.setState({ isUploading: false });
      const url =
        `/annotations/${annotation.typ}/${annotation.id}/merge/` +
        `${this.props.tracingType}/${this.props.annotationId}`;
      this.merge(url);
    } else if (info.file.status === "error") {
      Toast.messages(info.file.response.messages);
      this.setState({ isUploading: false });
    }
  };

  handleBeforeUploadNML = () => {
    this.setState({ isUploading: true });
  };

  handleMergeTaskType = (event: SyntheticInputEvent<>) => {
    event.preventDefault();
    const { selectedTaskType } = this.state;
    if (selectedTaskType != null) {
      const url =
        `/annotations/CompoundTaskType/${selectedTaskType}/` +
        `merge/${this.props.tracingType}/${this.props.annotationId}`;
      this.merge(url);
    }
  };

  handleMergeProject = (event: SyntheticInputEvent<>) => {
    event.preventDefault();
    const { selectedProject } = this.state;
    if (selectedProject != null) {
      const url =
        `/annotations/CompoundProject/${selectedProject}/merge/` +
        `${this.props.tracingType}/${this.props.annotationId}`;
      this.merge(url);
    }
  };

  handleMergeExplorativeAnnotation = async (event: SyntheticInputEvent<>) => {
    event.preventDefault();
    const { selectedExplorativeAnnotation } = this.state;

    if (selectedExplorativeAnnotation != null) {
      const url =
        `/annotations/Explorational/${selectedExplorativeAnnotation}/merge/` +
        `${this.props.tracingType}/${this.props.annotationId}`;
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
        className="merge-modal"
      >
        <Spin spinning={this.state.isUploading}>
          <Form layout="inline" onSubmit={this.handleMergeTaskType}>
            <Form.Item label="Task Type">
              <Select
                value={this.state.selectedTaskType}
                style={{ width: 200 }}
                onChange={this.handleChangeMergeTaskType}
              >
                {this.state.taskTypes.map(taskType => (
                  <Select.Option key={taskType.id} value={taskType.id}>
                    {taskType.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="default"
                disabled={this.state.selectedTaskType == null}
              >
                Merge
              </Button>
            </Form.Item>
          </Form>

          <Form layout="inline" onSubmit={this.handleMergeProject}>
            <Form.Item label="Project">
              <Select
                value={this.state.selectedProject}
                style={{ width: 200 }}
                onChange={this.handleChangeMergeProject}
              >
                {this.state.projects.map(project => (
                  <Select.Option key={project.id} value={project.id}>
                    {project.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="default"
                disabled={this.state.selectedProject == null}
              >
                Merge
              </Button>
            </Form.Item>
          </Form>

          <Form layout="inline">
            <Form.Item label="NML">
              <Upload
                name="nmlFile"
                action={"/annotations/upload"}
                headers={{ authorization: "authorization-text" }}
                beforeUpload={this.handleBeforeUploadNML}
                onChange={this.handleChangeNML}
                value={this.state.selectedNML}
                accept=".nml"
                showUploadList={false}
              >
                <Button icon="upload" style={{ width: 200 }}>
                  Upload NML and merge
                </Button>
              </Upload>
            </Form.Item>
          </Form>

          <Form layout="inline" onSubmit={this.handleMergeExplorativeAnnotation}>
            <Form.Item label="Explorative Annotation">
              <InputComponent
                value={this.state.selectedExplorativeAnnotation}
                style={{ width: 200 }}
                onChange={this.handleChangeMergeExplorativeAnnotation}
              />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="default"
                disabled={this.state.selectedExplorativeAnnotation.length !== 24}
              >
                Merge
              </Button>
            </Form.Item>
          </Form>
          <hr />
          <p>The merged tracing will be saved as a new explorative tracing.</p>
        </Spin>
      </Modal>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    annotationId: state.tracing.annotationId,
    tracingType: state.tracing.tracingType,
  };
}

export default connect(mapStateToProps)(MergeModalView);
