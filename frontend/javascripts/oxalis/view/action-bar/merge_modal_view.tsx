import { Alert, Modal, Button, Select, Form, Spin, Checkbox, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import React, { PureComponent } from "react";
import type { Dispatch } from "redux";
import { APIAnnotation, APIAnnotationTypeEnum } from "types/api_flow_types";
import { addTreesAndGroupsAction } from "oxalis/model/actions/skeletontracing_actions";
import { getSkeletonDescriptor } from "oxalis/model/accessors/skeletontracing_accessor";
import { createMutableTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  getAnnotationInformation,
  getAnnotationCompoundInformation,
  getTracingForAnnotationType,
} from "admin/admin_rest_api";
import { location } from "libs/window";
import InputComponent from "oxalis/view/components/input_component";
import Request from "libs/request";
import type { OxalisState, MutableTreeMap, TreeGroup } from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import messages from "messages";
import { makeComponentLazy } from "libs/react_helpers";
type ProjectInfo = {
  id: string;
  label: string;
};
type OwnProps = {
  isVisible: boolean;
  onOk: () => void;
};
type StateProps = {
  annotationId: string;
  annotationType: string;
};
type DispatchProps = {
  addTreesAndGroupsAction: (
    arg0: MutableTreeMap,
    arg1: Array<TreeGroup> | null | undefined,
  ) => void;
};
type Props = OwnProps & StateProps & DispatchProps;
type MergeModalViewState = {
  projects: Array<ProjectInfo>;
  selectedProject: string | null | undefined;
  selectedExplorativeAnnotation: string;
  isUploading: boolean;
  isFetchingData: boolean;
};
type ButtonWithCheckboxProps = {
  checkboxContent: React.ReactElement<React.ComponentProps<any>, any>;
  button: React.ReactElement<React.ComponentProps<any>, any>;
  onButtonClick: (arg0: React.SyntheticEvent, arg1: boolean) => Promise<void> | void;
};
type ButtonWithCheckboxState = {
  isChecked: boolean;
};

class ButtonWithCheckbox extends PureComponent<ButtonWithCheckboxProps, ButtonWithCheckboxState> {
  state: ButtonWithCheckboxState = {
    isChecked: true,
  };

  render() {
    return (
      <React.Fragment>
        <Form.Item>
          <Checkbox
            onChange={(event) =>
              this.setState({
                isChecked: event.target.checked,
              })
            }
            checked={this.state.isChecked}
          >
            {this.props.checkboxContent}
          </Checkbox>
        </Form.Item>
        <Form.Item>
          {React.cloneElement(this.props.button, {
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'evt' implicitly has an 'any' type.
            onClick: (evt) => this.props.onButtonClick(evt, this.state.isChecked),
          })}
        </Form.Item>
      </React.Fragment>
    );
  }
}

class _MergeModalView extends PureComponent<Props, MergeModalViewState> {
  state: MergeModalViewState = {
    projects: [],
    selectedProject: null,
    selectedExplorativeAnnotation: "",
    isUploading: false,
    isFetchingData: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({
      isFetchingData: true,
    });
    const projects = await Request.receiveJSON("/api/projects", {
      showErrorToast: false,
    });
    this.setState({
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
      projects: projects.map((project) => ({
        id: project.id,
        label: project.name,
      })),
      isFetchingData: false,
    });
  }

  async merge(url: string) {
    await api.tracing.save();
    const annotation = await Request.receiveJSON(url, {
      method: "POST",
    });
    Toast.success(messages["tracing.merged_with_redirect"]);
    const redirectUrl = `/annotations/${annotation.typ}/${annotation.id}`;
    await Utils.sleep(1500);
    location.href = redirectUrl;
  }

  handleChangeMergeProject = (project: string) => {
    this.setState({
      selectedProject: project,
    });
  };

  handleChangeMergeExplorativeAnnotation = (event: React.SyntheticEvent) => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      selectedExplorativeAnnotation: event.target.value,
    });
  };

  handleMergeProject = async (event: React.SyntheticEvent, isLocalMerge: boolean) => {
    event.preventDefault();
    const { selectedProject } = this.state;

    if (selectedProject != null) {
      if (isLocalMerge) {
        const annotation = await getAnnotationCompoundInformation(
          selectedProject,
          APIAnnotationTypeEnum.CompoundProject,
        );
        this.mergeAnnotationIntoActiveTracing(annotation);
      } else {
        const url =
          `/api/annotations/CompoundProject/${selectedProject}/merge/` +
          `${this.props.annotationType}/${this.props.annotationId}`;
        this.merge(url);
      }
    }
  };

  handleMergeExplorativeAnnotation = async (event: React.SyntheticEvent, isLocalMerge: boolean) => {
    event.preventDefault();
    const { selectedExplorativeAnnotation } = this.state;

    if (selectedExplorativeAnnotation != null) {
      if (isLocalMerge) {
        const annotation = await getAnnotationInformation(selectedExplorativeAnnotation);
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

    const skeletonDescriptorMaybe = getSkeletonDescriptor(annotation);

    if (skeletonDescriptorMaybe == null) {
      Toast.error(messages["merge.volume_unsupported"]);
      return;
    }

    const tracing = await getTracingForAnnotationType(annotation, skeletonDescriptorMaybe);

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'trees' does not exist on type 'ServerTra... Remove this comment to see the full error message
    if (!tracing || !tracing.trees) {
      Toast.error(messages["merge.volume_unsupported"]);
      return;
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'trees' does not exist on type 'ServerTra... Remove this comment to see the full error message
    const { trees, treeGroups } = tracing;
    this.setState({
      isUploading: true,
    });
    // Wait for an animation frame (but not longer than a second) so that the loading
    // animation is kicked off
    await Utils.animationFrame(1000);
    this.props.addTreesAndGroupsAction(createMutableTreeMapFromTreeArray(trees), treeGroups);
    this.setState({
      isUploading: false,
    });
    Toast.success(messages["tracing.merged"]);
    this.props.onOk();
  }

  render() {
    const mergeIntoActiveTracingCheckbox = (
      <React.Fragment>
        Merge into active annotation{" "}
        <Tooltip title="If this option is enabled, trees and tree groups will be imported directly into the currently opened annotation. If not, a new explorative annotation will be created in your account.">
          <InfoCircleOutlined
            style={{
              color: "gray",
            }}
          />
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
            style={{
              marginBottom: 12,
            }}
            message="If you would like to import NML files, please drag and drop them into the annotation view."
          />

          <Form
            layout="inline"
            style={{
              marginBottom: 8,
            }}
          >
            <Form.Item label="Project">
              <Select
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | never[]' is not assignable to type ... Remove this comment to see the full error message
                value={this.state.selectedProject || []}
                style={{
                  width: 200,
                }}
                onChange={this.handleChangeMergeProject}
                notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                options={this.state.projects.map((project) => ({
                  value: project.id,
                  label: project.label,
                }))}
              />
            </Form.Item>

            <ButtonWithCheckbox
              checkboxContent={mergeIntoActiveTracingCheckbox}
              button={
                // @ts-expect-error ts-migrate(2322) FIXME: Type '"default"' is not assignable to type 'SizeTy... Remove this comment to see the full error message
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
                style={{
                  width: 200,
                }}
                onChange={this.handleChangeMergeExplorativeAnnotation}
              />
            </Form.Item>
            <ButtonWithCheckbox
              checkboxContent={mergeIntoActiveTracingCheckbox}
              button={
                <Button
                  type="primary"
                  // @ts-expect-error ts-migrate(2322) FIXME: Type '"default"' is not assignable to type 'SizeTy... Remove this comment to see the full error message
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

const MergeModalView = makeComponentLazy(_MergeModalView);

function mapStateToProps(state: OxalisState): StateProps {
  return {
    annotationId: state.tracing.annotationId,
    annotationType: state.tracing.annotationType,
  };
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  addTreesAndGroupsAction(trees: MutableTreeMap, treeGroups: Array<TreeGroup> | null | undefined) {
    dispatch(addTreesAndGroupsAction(trees, treeGroups));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(MergeModalView);
