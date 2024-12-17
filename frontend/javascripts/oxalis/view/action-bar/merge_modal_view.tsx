import { Alert, Modal, Button, Select, Form, Spin, Tooltip } from "antd";
import { connect } from "react-redux";
import type React from "react";
import { PureComponent } from "react";
import type { Dispatch } from "redux";
import { type APIAnnotation, APIAnnotationTypeEnum } from "types/api_flow_types";
import { addTreesAndGroupsAction } from "oxalis/model/actions/skeletontracing_actions";
import { getSkeletonDescriptor } from "oxalis/model/accessors/skeletontracing_accessor";
import { createMutableTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  getUnversionedAnnotationInformation,
  getAnnotationCompoundInformation,
  getTracingForAnnotationType,
} from "admin/admin_rest_api";
import { location } from "libs/window";
import InputComponent from "oxalis/view/components/input_component";
import Request from "libs/request";
import Constants from "oxalis/constants";
import type { OxalisState, MutableTreeMap, TreeGroup } from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { api } from "oxalis/singletons";
import messages from "messages";
import { makeComponentLazy } from "libs/react_helpers";
type ProjectInfo = {
  id: string;
  label: string;
};
type OwnProps = {
  isOpen: boolean;
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

  async createMergedAnnotation(url: string) {
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

  handleChangeMergeExplorativeAnnotation = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      selectedExplorativeAnnotation: event.target.value,
    });
  };

  handleMergeProject = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    const { selectedProject } = this.state;

    if (selectedProject != null) {
      const url =
        `/api/annotations/CompoundProject/${selectedProject}/merge/` +
        `${this.props.annotationType}/${this.props.annotationId}`;
      this.createMergedAnnotation(url);
    }
  };

  handleImportProject = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    const { selectedProject } = this.state;

    if (selectedProject != null) {
      const annotation = await getAnnotationCompoundInformation(
        selectedProject,
        APIAnnotationTypeEnum.CompoundProject,
      );
      this.mergeAnnotationIntoActiveTracing(annotation);
    }
  };

  handleMergeExplorativeAnnotation = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    const { selectedExplorativeAnnotation } = this.state;

    if (selectedExplorativeAnnotation != null) {
      const url =
        `/api/annotations/Explorational/${selectedExplorativeAnnotation}/merge/` +
        `${this.props.annotationType}/${this.props.annotationId}`;
      this.createMergedAnnotation(url);
    }
  };

  handleImportExplorativeAnnotation = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    const { selectedExplorativeAnnotation } = this.state;

    if (selectedExplorativeAnnotation != null) {
      const annotation = await getUnversionedAnnotationInformation(selectedExplorativeAnnotation);
      this.mergeAnnotationIntoActiveTracing(annotation);
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
    return (
      <Modal
        title="Merge"
        open={this.props.isOpen}
        onCancel={this.props.onOk}
        className="merge-modal"
        width={700}
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
                loading={this.state.isFetchingData}
                options={this.state.projects.map((project) => ({
                  value: project.id,
                  label: project.label,
                }))}
              />
            </Form.Item>
            <Form.Item>
              <Tooltip title="Imports trees and tree groups (but no volume data) directly into the currently opened annotation.">
                <Button
                  disabled={this.state.selectedProject == null}
                  onClick={this.handleImportProject}
                >
                  Import trees here
                </Button>
              </Tooltip>
            </Form.Item>
            <Form.Item>
              <Tooltip title="Creates a new explorative annotation in your account with all merged contents of the current and selected annotations.">
                <Button
                  type="primary"
                  disabled={this.state.selectedProject == null}
                  onClick={this.handleMergeProject}
                >
                  Merge
                </Button>
              </Tooltip>
            </Form.Item>
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
            <Form.Item>
              <Tooltip title="Imports trees and tree groups (but no volume data) directly into the currently opened annotation.">
                <Button
                  disabled={
                    this.state.selectedExplorativeAnnotation.length !==
                    Constants.OBJECT_ID_STRING_LENGTH
                  }
                  onClick={this.handleImportExplorativeAnnotation}
                >
                  Import trees here
                </Button>
              </Tooltip>
            </Form.Item>
            <Form.Item>
              <Tooltip title="Creates a new explorative annotation in your account with all merged contents of the current and selected annotations.">
                <Button
                  type="primary"
                  disabled={
                    this.state.selectedExplorativeAnnotation.length !==
                    Constants.OBJECT_ID_STRING_LENGTH
                  }
                  onClick={this.handleMergeExplorativeAnnotation}
                >
                  Merge
                </Button>
              </Tooltip>
            </Form.Item>
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
