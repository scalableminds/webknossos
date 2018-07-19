// @flow
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import Toast from "libs/toast";
import Request from "libs/request";
import { Alert, Modal, Button, Select, Form, Spin } from "antd";
import messages from "messages";
import InputComponent from "oxalis/view/components/input_component";
import api from "oxalis/api/internal_api";
import type { OxalisState } from "oxalis/store";
import type { RouterHistory } from "react-router-dom";

type AnnotationInfoType = {
  typ: string,
  id: string,
};

type ProjectInfoType = {
  id: string,
  label: string,
};

type StateProps = {
  annotationId: string,
  tracingType: string,
};
type Props = {
  isVisible: boolean,
  onOk: () => void,
  history: RouterHistory,
} & StateProps;

type MergeModalViewState = {
  projects: Array<ProjectInfoType>,
  selectedProject: ?string,
  selectedExplorativeAnnotation: string,
  isUploading: boolean,
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
  state = {
    projects: [],
    selectedProject: null,
    selectedExplorativeAnnotation: "",
    isUploading: false,
  };

  componentWillMount() {
    (async () => {
      const [projects] = await Request.receiveJSON("/api/projects", { doNotCatch: true });
      this.setState({
        projects: projects.map(project => ({ id: project.id, label: project.name })),
      });
    })();
  }

  async merge(url: string) {
    await api.tracing.save();
    const annotation = await Request.receiveJSON(url);
    Toast.success(messages["tracing.merged"]);
    const redirectUrl = `/annotations/${annotation.typ}/${annotation.id}`;
    this.props.history.push(redirectUrl);
  }

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
        `/api/annotations/${annotation.typ}/${annotation.id}/merge/` +
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

  handleMergeProject = (event: SyntheticInputEvent<>) => {
    event.preventDefault();
    const { selectedProject } = this.state;
    if (selectedProject != null) {
      const url =
        `/api/annotations/CompoundProject/${selectedProject}/merge/` +
        `${this.props.tracingType}/${this.props.annotationId}`;
      this.merge(url);
    }
  };

  handleMergeExplorativeAnnotation = async (event: SyntheticInputEvent<>) => {
    event.preventDefault();
    const { selectedExplorativeAnnotation } = this.state;

    if (selectedExplorativeAnnotation != null) {
      const url =
        `/api/annotations/Explorational/${selectedExplorativeAnnotation}/merge/` +
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
          <Alert
            type="info"
            style={{ marginBottom: 12 }}
            message="The merged tracing will be saved as a new explorative tracing. If you would like to
            import NML files, please simply drag and drop them into the tracing view."
          />
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
        </Spin>
      </Modal>
    );
  }
}

function mapStateToProps(state: OxalisState): StateProps {
  return {
    annotationId: state.tracing.annotationId,
    tracingType: state.tracing.tracingType,
  };
}

export default connect(mapStateToProps)(withRouter(MergeModalView));
