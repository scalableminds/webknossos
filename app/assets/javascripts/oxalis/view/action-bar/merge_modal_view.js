// @flow
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import Toast from "libs/toast";
import Request from "libs/request";
import { Icon, Alert, Modal, Button, Select, Form, Spin, Checkbox, Tooltip } from "antd";
import messages from "messages";
import InputComponent from "oxalis/view/components/input_component";
import api from "oxalis/api/internal_api";
import type { OxalisState, TreeMapType, TreeGroupType } from "oxalis/store";
import type { RouterHistory } from "react-router-dom";
import { getAnnotationInformation, getTracingForAnnotation } from "admin/admin_rest_api";
import { addTreesAndGroupsAction } from "oxalis/model/actions/skeletontracing_actions";
import { createTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import Utils from "libs/utils";
import type { APIAnnotationType } from "admin/api_flow_types";

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
  addTreesAndGroupsAction: (TreeMapType, Array<TreeGroupType>) => void,
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

type ButtonWithCheckboxProps = {
  checkboxContent: React$Element<*>,
  button: React$Element<*>,
  onButtonClick: (SyntheticInputEvent<>, boolean) => Promise<void> | void,
};

type ButtonWithCheckboxState = {
  isChecked: boolean,
};

class ButtonWithCheckbox extends PureComponent<ButtonWithCheckboxProps, ButtonWithCheckboxState> {
  state = {
    isChecked: true,
  };
  render() {
    return (
      <React.Fragment>
        <Form.Item>
          <Checkbox
            onChange={event => this.setState({ isChecked: event.target.checked })}
            checked={this.state.isChecked}
          >
            {this.props.checkboxContent}
          </Checkbox>
        </Form.Item>
        <Form.Item>
          {React.cloneElement(this.props.button, {
            onClick: evt => this.props.onButtonClick(evt, this.state.isChecked),
          })}
        </Form.Item>
      </React.Fragment>
    );
  }
}

class MergeModalView extends PureComponent<Props, MergeModalViewState> {
  state = {
    projects: [],
    selectedProject: null,
    selectedExplorativeAnnotation: "",
    isUploading: false,
  };

  componentWillMount() {
    (async () => {
      const projects = await Request.receiveJSON("/api/projects", { doNotCatch: true });
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

  handleBeforeUploadNML = () => {
    this.setState({ isUploading: true });
  };

  handleMergeProject = async (event: SyntheticInputEvent<>, isLocalMerge: boolean) => {
    event.preventDefault();
    const { selectedProject } = this.state;
    if (selectedProject != null) {
      if (isLocalMerge) {
        const annotation = await getAnnotationInformation(selectedProject, "CompoundProject");
        this.mergeAnnotationIntoActiveTracing(annotation);
      } else {
        const url =
          `/api/annotations/CompoundProject/${selectedProject}/merge/` +
          `${this.props.tracingType}/${this.props.annotationId}`;
        this.merge(url);
      }
    }
  };

  handleMergeExplorativeAnnotation = async (
    event: SyntheticInputEvent<>,
    isLocalMerge: boolean,
  ) => {
    event.preventDefault();
    const { selectedExplorativeAnnotation } = this.state;

    if (selectedExplorativeAnnotation != null) {
      if (isLocalMerge) {
        const annotation = await getAnnotationInformation(
          selectedExplorativeAnnotation,
          "Explorational",
        );
        this.mergeAnnotationIntoActiveTracing(annotation);
      } else {
        const url =
          `/api/annotations/Explorational/${selectedExplorativeAnnotation}/merge/` +
          `${this.props.tracingType}/${this.props.annotationId}`;
        this.merge(url);
      }
    }
  };

  async mergeAnnotationIntoActiveTracing(annotation: APIAnnotationType): Promise<void> {
    const tracing = await getTracingForAnnotation(annotation);
    if (tracing.trees) {
      const { trees, treeGroups } = tracing;
      this.setState({ isUploading: true });
      // Wait for an animation frame so that the loading animation is kicked off
      await Utils.animationFrame();
      this.props.addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), treeGroups || []);
      this.setState({ isUploading: false });
      Toast.success(messages["tracing.merged"]);
    } else {
      Toast.error("Merging is not supported for volume tracings.");
      return;
    }
  }

  render() {
    const mergeIntoActiveTracingCheckbox = (
      <React.Fragment>
        Merge into active tracing{" "}
        <Tooltip
          title={
            "If this option is enabled, trees and tree groups will be imported directly into the currently opened tracing. If not, a new explorative annotation will be created in your account."
          }
        >
          <Icon type="info-circle-o" style={{ color: "gray" }} />
        </Tooltip>
      </React.Fragment>
    );

    return (
      <Modal
        title="Merge"
        visible={this.props.isVisible}
        onOk={this.props.onOk}
        onCancel={this.props.onOk}
        className="merge-modal"
        width={800}
        footer={null}
      >
        <Spin spinning={this.state.isUploading}>
          <Alert
            type="info"
            style={{ marginBottom: 12 }}
            message="The merged tracing will be saved as a new explorative tracing. If you would like to
            import NML files, please simply drag and drop them into the tracing view."
          />
          <Form layout="inline">
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

            <ButtonWithCheckbox
              checkboxContent={mergeIntoActiveTracingCheckbox}
              button={
                <Button type="primary" size="default" disabled={this.state.selectedProject == null}>
                  Merge
                </Button>
              }
              onButtonClick={this.handleMergeProject}
            />
          </Form>

          <Form layout="inline">
            <Form.Item label="Explorative Annotation">
              <InputComponent
                value={this.state.selectedExplorativeAnnotation}
                style={{ width: 200 }}
                onChange={this.handleChangeMergeExplorativeAnnotation}
              />
            </Form.Item>
            <ButtonWithCheckbox
              checkboxContent={mergeIntoActiveTracingCheckbox}
              button={
                <Button
                  type="primary"
                  size="default"
                  disabled={this.state.selectedExplorativeAnnotation.length !== 24}
                >
                  Merge
                </Button>
              }
              onButtonClick={this.handleMergeExplorativeAnnotation}
            />
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

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  addTreesAndGroupsAction(trees: TreeMapType, treeGroups: Array<TreeGroupType>) {
    dispatch(addTreesAndGroupsAction(trees, treeGroups));
  },
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(withRouter(MergeModalView));
