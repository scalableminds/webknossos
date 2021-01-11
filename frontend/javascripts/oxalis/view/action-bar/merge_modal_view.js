// @flow
import { Icon, Alert, Modal, Button, Select, Form, Spin, Checkbox, Tooltip } from "antd";
import { connect } from "react-redux";
import React, { PureComponent } from "react";
import type { Dispatch } from "redux";

import type { APIAnnotation } from "types/api_flow_types";
import { addTreesAndGroupsAction } from "oxalis/model/actions/skeletontracing_actions";
import { createMutableTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { getAnnotationInformation, getTracingForAnnotationType } from "admin/admin_rest_api";
import { location } from "libs/window";
import InputComponent from "oxalis/view/components/input_component";
import Request from "libs/request";
import Store, { type OxalisState, type MutableTreeMap, type TreeGroup } from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import messages from "messages";

type ProjectInfo = {
  id: string,
  label: string,
};

type OwnProps = {|
  isVisible: boolean,
  onOk: () => void,
|};
type StateProps = {|
  annotationId: string,
  annotationType: string,
|};
type DispatchProps = {|
  addTreesAndGroupsAction: (MutableTreeMap, ?Array<TreeGroup>) => void,
|};
type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

type MergeModalViewState = {
  projects: Array<ProjectInfo>,
  selectedProject: ?string,
  selectedExplorativeAnnotation: string,
  isUploading: boolean,
  isFetchingData: boolean,
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
    isFetchingData: false,
  };

  componentWillMount() {
    (async () => {
      this.setState({ isFetchingData: true });
      const projects = await Request.receiveJSON("/api/projects", { showErrorToast: false });
      this.setState({
        projects: projects.map(project => ({
          id: project.id,
          label: project.name,
        })),
        isFetchingData: false,
      });
    })();
  }

  async merge(url: string) {
    await api.tracing.save();
    const annotation = await Request.receiveJSON(url, { method: "POST" });
    Toast.success(messages["tracing.merged_with_redirect"]);
    const redirectUrl = `/annotations/${annotation.typ}/${annotation.id}`;
    await Utils.sleep(1500);
    location.href = redirectUrl;
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
          `${this.props.annotationType}/${this.props.annotationId}`;
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
          `${this.props.annotationType}/${this.props.annotationId}`;
        this.merge(url);
      }
    }
  };

  async mergeAnnotationIntoActiveTracing(annotation: APIAnnotation): Promise<void> {
    if (annotation.dataSetName !== Store.getState().dataset.name) {
      Toast.error(messages["merge.different_dataset"]);
      return;
    }
    const tracing = await getTracingForAnnotationType(annotation, "skeleton");
    if (!tracing || !tracing.trees) {
      Toast.error(messages["merge.volume_unsupported"]);
      return;
    }
    const { trees, treeGroups } = tracing;
    this.setState({ isUploading: true });
    // Wait for an animation frame (but not longer than a second) so that the loading
    // animation is kicked off
    await Utils.animationFrame(1000);
    this.props.addTreesAndGroupsAction(createMutableTreeMapFromTreeArray(trees), treeGroups);
    this.setState({ isUploading: false });
    Toast.success(messages["tracing.merged"]);
    this.props.onOk();
  }

  render() {
    const mergeIntoActiveTracingCheckbox = (
      <React.Fragment>
        Merge into active annotation{" "}
        <Tooltip title="If this option is enabled, trees and tree groups will be imported directly into the currently opened annotation. If not, a new explorative annotation will be created in your account.">
          <Icon type="info-circle-o" style={{ color: "gray" }} />
        </Tooltip>
      </React.Fragment>
    );

    return (
      <Modal
        title="Merge"
        visible={this.props.isVisible}
        onCancel={this.props.onOk}
        className="merge-modal"
        width={800}
        footer={null}
      >
        <Spin spinning={this.state.isUploading}>
          <Alert
            type="info"
            style={{ marginBottom: 12 }}
            message="If you would like to import NML files, please drag and drop them into the annotation view."
          />

          <Form layout="inline">
            <Form.Item label="Project">
              <Select
                value={this.state.selectedProject}
                style={{ width: 200 }}
                onChange={this.handleChangeMergeProject}
                notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
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
    annotationType: state.tracing.annotationType,
  };
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  addTreesAndGroupsAction(trees: MutableTreeMap, treeGroups: ?Array<TreeGroup>) {
    dispatch(addTreesAndGroupsAction(trees, treeGroups));
  },
});

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(MergeModalView);
