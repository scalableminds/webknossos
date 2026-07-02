import { CheckCircleOutlined, InfoCircleOutlined, LoadingOutlined } from "@ant-design/icons";
import {
  getAnnotationCompoundInformation,
  getTracingForAnnotationType,
  getUnversionedAnnotationInformation,
} from "admin/rest_api";
import {
  Button,
  Checkbox,
  Col,
  Divider,
  Flex,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Spin,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { makeComponentLazy } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import Request from "libs/request";
import Toast from "libs/toast";
import { animationFrame, sleep } from "libs/utils";
import { location } from "libs/window";
import messages from "messages";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { type APIAnnotation, APIAnnotationTypeEnum } from "types/api_types";
import { getSkeletonDescriptor } from "viewer/model/accessors/skeletontracing_accessor";
import { addTreesAndGroupsAction } from "viewer/model/actions/skeletontracing_actions";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { api } from "viewer/singletons";
import Store from "viewer/store";

type ProjectInfo = {
  id: string;
  label: string;
};
type Props = {
  isOpen: boolean;
  onOk: () => void;
};
type SourceType = "project" | "annotation";
type AnnotationFetchStatus = "idle" | "fetching" | "success" | "error";

function extractAnnotationId(input: string): string | null {
  // Accepts a plain 24-char hex id or any annotation URL containing one,
  // e.g. https://host/annotations/<id> or /annotations/Explorational/<id>
  const fromUrl = input.match(/annotations\/(?:\w+\/)?([0-9a-f]{24})/i);
  if (fromUrl) return fromUrl[1];
  const bare = input.trim().match(/^[0-9a-f]{24}$/i);
  return bare ? bare[0] : null;
}

const fieldLabel = (label: string) => (
  <Typography.Text strong style={{ display: "block", fontSize: 13, marginBottom: 8 }}>
    {label}
  </Typography.Text>
);

function _MergeModalView({ isOpen, onOk }: Props) {
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const annotationType = useWkSelector((state) => state.annotation.annotationType);
  const dispatch = useDispatch();
  const { token } = theme.useToken();

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [sourceType, setSourceType] = useState<SourceType>("annotation");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [annotationInput, setAnnotationInput] = useState("");
  const [fetchedAnnotation, setFetchedAnnotation] = useState<APIAnnotation | null>(null);
  const [annotationFetchStatus, setAnnotationFetchStatus] = useState<AnnotationFetchStatus>("idle");
  const [shouldRemapSegmentIds, setShouldRemapSegmentIds] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);

  useEffect(() => {
    async function fetchProjects() {
      setIsFetchingData(true);
      const projectsResponse: Array<{ id: string; name: string }> = await Request.receiveJSON(
        "/api/projects",
        {
          showErrorToast: false,
        },
      );
      setProjects(
        projectsResponse.map((project) => ({
          id: project.id,
          label: project.name,
        })),
      );
      setIsFetchingData(false);
    }
    fetchProjects();
  }, []);

  const extractedAnnotationId = extractAnnotationId(annotationInput);
  const latestRequestedAnnotationIdRef = useRef<string | null>(null);

  useEffect(() => {
    latestRequestedAnnotationIdRef.current = extractedAnnotationId;
    if (extractedAnnotationId == null) {
      setFetchedAnnotation(null);
      setAnnotationFetchStatus("idle");
      return;
    }
    setAnnotationFetchStatus("fetching");
    (async () => {
      try {
        const annotation = await getUnversionedAnnotationInformation(extractedAnnotationId, {
          showErrorToast: false,
        });
        if (latestRequestedAnnotationIdRef.current !== extractedAnnotationId) return;
        setFetchedAnnotation(annotation);
        setAnnotationFetchStatus("success");
      } catch (_exception) {
        if (latestRequestedAnnotationIdRef.current !== extractedAnnotationId) return;
        setFetchedAnnotation(null);
        setAnnotationFetchStatus("error");
      }
    })();
  }, [extractedAnnotationId]);

  const isSourceValid =
    sourceType === "project"
      ? selectedProject != null
      : annotationFetchStatus === "success" && fetchedAnnotation != null;

  async function createMergedAnnotation(url: string) {
    await api.tracing.save();
    const annotation = await Request.receiveJSON(url, {
      method: "POST",
    });
    Toast.success(messages["tracing.merged_with_redirect"]);
    const redirectUrl = `/annotations/${annotation.typ}/${annotation.id}`;
    await sleep(1500);
    location.href = redirectUrl;
  }

  async function mergeAnnotationIntoActiveTracing(annotation: APIAnnotation): Promise<void> {
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
    setIsUploading(true);
    // Wait for an animation frame (but not longer than a second) so that the loading
    // animation is kicked off
    await animationFrame(1000);
    dispatch(addTreesAndGroupsAction(createMutableTreeMapFromTreeArray(trees), treeGroups));
    setIsUploading(false);
    Toast.success(messages["tracing.merged"]);
    onOk();
  }

  const handleMerge = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const url =
      sourceType === "project"
        ? `/api/annotations/CompoundProject/${selectedProject}/merge/` +
          `${annotationType}/${annotationId}?remapSegmentIds=${shouldRemapSegmentIds}`
        : `/api/annotations/Explorational/${extractedAnnotationId}/merge/` +
          `${annotationType}/${annotationId}?remapSegmentIds=${shouldRemapSegmentIds}`;
    createMergedAnnotation(url);
  };

  const handleImportTrees = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (sourceType === "project") {
      if (selectedProject == null) return;
      const annotation = await getAnnotationCompoundInformation(
        selectedProject,
        APIAnnotationTypeEnum.CompoundProject,
      );
      mergeAnnotationIntoActiveTracing(annotation);
    } else {
      if (fetchedAnnotation == null) return;
      mergeAnnotationIntoActiveTracing(fetchedAnnotation);
    }
  };

  const annotationInputSuffix =
    annotationFetchStatus === "fetching" ? (
      <LoadingOutlined />
    ) : annotationFetchStatus === "success" ? (
      <CheckCircleOutlined style={{ color: token.colorSuccess }} />
    ) : (
      <span />
    );

  const annotationInputHint =
    annotationInput !== "" && extractedAnnotationId == null
      ? "No valid annotation ID recognized."
      : annotationFetchStatus === "error"
        ? "Annotation not found or not accessible."
        : null;

  return (
    <Modal
      title="Merge Annotations"
      open={isOpen}
      onCancel={onOk}
      width={700}
      footer={
        <Flex justify="flex-end" align="center" gap={12}>
          <Tooltip title="Imports skeleton trees (but no volume data) directly into the currently opened annotation.">
            <Button type="primary" disabled={!isSourceValid} onClick={handleImportTrees}>
              Import trees here
            </Button>
          </Tooltip>
          <Tooltip title="Creates a new annotation in your account with all merged contents of the current and selected annotations, including volume layers.">
            <Button type="primary" disabled={!isSourceValid} onClick={handleMerge}>
              Merge
            </Button>
          </Tooltip>
        </Flex>
      }
    >
      <Spin spinning={isUploading}>
        <Row gutter={32} style={{ marginBottom: 12 }}>
          <Col span={12}>
            <Flex vertical gap={12}>
              <Typography.Text type="secondary">
                <p>
                  Merge another annotation into this one, either from a single annotation or all
                  annotations of a project.
                </p>
                <p>
                  <b>Segment Ids:</b> For annotations with volume layers, non-zero segmentation
                  voxels of the merged-in annotation overwrite those of the current annotation.
                </p>
              </Typography.Text>
              <Typography.Text type="secondary">
                <b>Tip:</b> NML files can simply be dragged and dropped into the annotation view to
                import them.
              </Typography.Text>
            </Flex>
          </Col>
          <Col span={12}>
            <Flex vertical gap={16}>
              <Divider titlePlacement="left" style={{ margin: 0 }}>
                Source
              </Divider>
              <Segmented
                block
                value={sourceType}
                onChange={(value) => setSourceType(value as SourceType)}
                options={[
                  { value: "annotation", label: "Annotation" },
                  { value: "project", label: "Project" },
                ]}
              />
              {sourceType === "project" ? (
                <div>
                  {fieldLabel("Project")}
                  <Select
                    value={selectedProject}
                    style={{ width: "100%" }}
                    placeholder="Select a project…"
                    onChange={setSelectedProject}
                    loading={isFetchingData}
                    options={projects.map((project) => ({
                      value: project.id,
                      label: project.label,
                    }))}
                  />
                </div>
              ) : (
                <div>
                  {fieldLabel("Annotation")}
                  <Input
                    value={annotationInput}
                    placeholder="Paste an annotation link or ID…"
                    onChange={(event) => setAnnotationInput(event.target.value)}
                    suffix={annotationInputSuffix}
                  />
                  {annotationInputHint != null ? (
                    <Typography.Text
                      type="secondary"
                      style={{ display: "block", fontSize: 12, marginTop: 7 }}
                    >
                      {annotationInputHint}
                    </Typography.Text>
                  ) : null}
                </div>
              )}
              <Divider titlePlacement="left" style={{ margin: 0 }}>
                Settings
              </Divider>
              <Checkbox
                checked={shouldRemapSegmentIds}
                onChange={(ev) => setShouldRemapSegmentIds(ev.target.checked)}
              >
                Remap segment IDs
                <Tooltip
                  title="Remap the segment ids of the merged-in annotation to keep all segment ids unique. Deselect it to keep all ids as they are. Deselecting this is recommended for annotations based on fallback segmentation layers. This option has no effect on “Import trees here”, which copies skeleton data only."
                  placement="top"
                >
                  <InfoCircleOutlined className="icon-margin-left" />
                </Tooltip>
              </Checkbox>
            </Flex>
          </Col>
        </Row>
      </Spin>
    </Modal>
  );
}

const MergeModalView = makeComponentLazy(_MergeModalView);

export default MergeModalView;
