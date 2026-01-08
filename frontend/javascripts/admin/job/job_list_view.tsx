import {
  CheckCircleTwoTone,
  ClockCircleTwoTone,
  CloseCircleOutlined,
  CloseCircleTwoTone,
  DownloadOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  QuestionCircleTwoTone,
} from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelJob, getJobs, retryJob } from "admin/rest_api";
import { App, Flex, Input, Spin, Table, Tooltip, Typography } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import LinkButton from "components/link_button";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { formatCreditsString, formatWkLibsNdBBox } from "libs/format_utils";
import Persistence from "libs/persistence";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type APIJob, APIJobCommand } from "types/api_types";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";

// Unfortunately, the twoToneColor (nor the style) prop don't support
// CSS variables.
export const TOOLTIP_MESSAGES_AND_ICONS = {
  UNKNOWN: {
    tooltip:
      "The status information for this job could not be retrieved. Please try again in a few minutes, or contact us if you need assistance.",
    icon: <QuestionCircleTwoTone twoToneColor="#a3a3a3" className="icon-margin-right" />,
  },
  SUCCESS: {
    tooltip: "This job has successfully been executed.",
    icon: <CheckCircleTwoTone twoToneColor="#49b21b" className="icon-margin-right" />,
  },
  PENDING: {
    tooltip: "This job will run as soon as a worker becomes available.",
    icon: <ClockCircleTwoTone twoToneColor="#d89614" className="icon-margin-right" />,
  },
  STARTED: {
    tooltip: "This job is currently running.",
    icon: <LoadingOutlined className="icon-margin-right" />,
  },
  FAILURE: {
    tooltip:
      "Something went wrong when executing this job. Feel free to contact us if you need assistance.",
    icon: <CloseCircleTwoTone twoToneColor="#a61d24" className="icon-margin-right" />,
  },
  CANCELLED: {
    tooltip: "This job was cancelled.",
    icon: <CloseCircleTwoTone twoToneColor="#aaaaaa" className="icon-margin-right" />,
  },
};
const refreshInterval = 5000;
const { Column } = Table;
const { Search } = Input;

export const getShowTrainingDataLink = (
  modal: ReturnType<typeof App.useApp>["modal"],
  trainingAnnotations: {
    annotationId: string;
  }[],
) => {
  return trainingAnnotations == null ? null : trainingAnnotations.length > 1 ? (
    <LinkButton
      icon={<EyeOutlined />}
      onClick={() => {
        modal.info({
          title: "Training Data",
          closable: true,
          maskClosable: true,
          content: (
            <div>
              The following annotations were used during training:
              <ul style={{ padding: 15 }}>
                {trainingAnnotations.map((annotation: { annotationId: string }, index: number) => (
                  <li key={`annotation_${index}`}>
                    <a
                      href={`/annotations/${annotation.annotationId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Annotation {index + 1}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ),
        });
      }}
    >
      Show Training Data
    </LinkButton>
  ) : (
    <LinkButton
      icon={<EyeOutlined />}
      href={`/annotations/${trainingAnnotations[0].annotationId}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      Show Training Data
    </LinkButton>
  );
};

type State = {
  isLoading: boolean;
  jobs: Array<APIJob>;
  searchQuery: string;
};
const persistence = new Persistence<Pick<State, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "jobList",
);

export function JobState({ job }: { job: APIJob }) {
  const { tooltip, icon } = TOOLTIP_MESSAGES_AND_ICONS[job.state];

  const jobStateNormalized = _.capitalize(job.state.toLowerCase());

  return (
    <Tooltip title={tooltip}>
      <span>{icon}</span>
      {jobStateNormalized}
    </Tooltip>
  );
}

function JobListView() {
  const queryClient = useQueryClient();
  const { modal } = App.useApp();
  const { data: jobs, isLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: getJobs,
    refetchInterval: refreshInterval,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const isCurrentUserSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);

  useEffect(() => {
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
  }, []);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function getLinkToDataset(job: APIJob) {
    // prefer updated link over legacy link.
    if (job.args.datasetId != null)
      return getViewDatasetURL({
        name: job.args.datasetName || "unknown_name",
        id: job.args.datasetId,
      });
    if (
      job.organizationId != null &&
      (job.args.datasetName != null || job.args.datasetDirectoryName != null)
    )
      return `/datasets/${job.organizationId}/${job.args.datasetDirectoryName || job.args.datasetName}/view`;
    return null;
  }

  function renderDescription(__: any, job: APIJob) {
    const linkToDataset = getLinkToDataset(job);
    const layerName = job.args.annotationLayerName || job.args.layerName;

    if (job.command === APIJobCommand.CONVERT_TO_WKW && job.args.datasetName) {
      return <span>{`Conversion to WKW of ${job.args.datasetName}`}</span>;
    } else if (job.command === APIJobCommand.EXPORT_TIFF && linkToDataset != null) {
      const labelToAnnotationOrDataset =
        job.args.annotationId != null ? (
          <Link to={`/annotations/${job.args.annotationId}`}>
            annotation of dataset {job.args.datasetName}
          </Link>
        ) : (
          <Link to={linkToDataset}>dataset {job.args.datasetName}</Link>
        );
      return (
        <span>
          Tiff export of layer {layerName} from {labelToAnnotationOrDataset} (Bounding Box{" "}
          {job.args.ndBoundingBox
            ? formatWkLibsNdBBox(job.args.ndBoundingBox)
            : job.args.boundingBox}
          )
        </span>
      );
    } else if (job.command === APIJobCommand.RENDER_ANIMATION && linkToDataset != null) {
      return (
        <span>
          Animation rendering for layer {layerName} of dataset{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>
        </span>
      );
    } else if (job.command === APIJobCommand.COMPUTE_MESH_FILE && linkToDataset != null) {
      return (
        <span>
          Mesh file computation for <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.command === APIJobCommand.COMPUTE_SEGMENT_INDEX_FILE && linkToDataset != null) {
      return (
        <span>
          Segment index file computation for <Link to={linkToDataset}>
            {job.args.datasetName}
          </Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.FIND_LARGEST_SEGMENT_ID &&
      linkToDataset != null &&
      layerName
    ) {
      return (
        <span>
          Largest segment id detection for layer {layerName} of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.command === APIJobCommand.INFER_NUCLEI && linkToDataset != null && layerName) {
      return (
        <span>
          Nuclei inferral for layer {layerName} of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.INFER_NEURONS &&
      linkToDataset != null &&
      layerName &&
      job.args.modelId == null
    ) {
      return (
        <span>
          AI Neuron inferral for layer <i>{layerName}</i> of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      (job.command === APIJobCommand.DEPRECATED_INFER_WITH_MODEL ||
        job.command === APIJobCommand.INFER_NEURONS) &&
      linkToDataset != null
    ) {
      return (
        <span>
          Run AI segmentation with custom model on{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>
        </span>
      );
    } else if (
      job.command === APIJobCommand.INFER_MITOCHONDRIA &&
      linkToDataset != null &&
      layerName
    ) {
      return (
        <span>
          AI Mitochondria inferral for layer <i>{layerName}</i> of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.INFER_INSTANCES &&
      linkToDataset != null &&
      layerName
    ) {
      return (
        <span>
          AI instance segmentation for layer <i>{layerName}</i> of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.command === APIJobCommand.ALIGN_SECTIONS && linkToDataset != null && layerName) {
      return (
        <span>
          Align sections for layer <i>{layerName}</i> of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.MATERIALIZE_VOLUME_ANNOTATION &&
      linkToDataset != null
    ) {
      return (
        <span>
          Materialize annotation for {layerName ? ` layer ${layerName} of ` : " "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>
          {job.args.mergeSegments
            ? ". This includes merging the segments that were merged via merger mode."
            : null}
        </span>
      );
    } else if (
      job.command === APIJobCommand.TRAIN_NEURON_MODEL ||
      job.command === APIJobCommand.TRAIN_INSTANCE_MODEL ||
      job.command === APIJobCommand.DEPRECATED_TRAIN_MODEL
    ) {
      const numberOfTrainingAnnotations = job.args.trainingAnnotations?.length || 0;
      const modelName =
        job.command === APIJobCommand.TRAIN_NEURON_MODEL ||
        job.command === APIJobCommand.DEPRECATED_TRAIN_MODEL
          ? "neuron model"
          : "instance model";
      return (
        <span>
          {`Train ${modelName} on ${numberOfTrainingAnnotations} ${Utils.pluralize("annotation", numberOfTrainingAnnotations)}. `}
          {getShowTrainingDataLink(modal, job.args.trainingAnnotations)}
        </span>
      );
    } else {
      return <span>{job.command}</span>;
    }
  }

  function renderWorkflowLink(__: any, job: APIJob) {
    return job.voxelyticsWorkflowHash != null ? (
      <Link to={`/workflows/${job.voxelyticsWorkflowHash}`}>Workflow</Link>
    ) : null;
  }

  function renderActions(__: any, job: APIJob) {
    if (job.state === "PENDING" || job.state === "STARTED") {
      return (
        <AsyncLink
          onClick={async () => {
            const isDeleteConfirmed = await confirmAsync({
              title: <p>Are you sure you want to cancel job {job.id}?</p>,
              okText: "Yes, cancel job",
              cancelText: "No, keep it",
            });

            if (isDeleteConfirmed) {
              cancelJob(job.id).then(() => queryClient.invalidateQueries({ queryKey: ["jobs"] }));
            }
          }}
          icon={<CloseCircleOutlined className="icon-margin-right" />}
        >
          Cancel
        </AsyncLink>
      );
    } else if ((job.state === "FAILURE" || job.state === "CANCELLED") && isCurrentUserSuperUser) {
      return (
        <Tooltip title="Restarts the workflow from the failed task, skipping and reusing artifacts from preceding tasks that were already successful.">
          <AsyncLink
            onClick={async () => {
              try {
                await retryJob(job.id);
                await queryClient.invalidateQueries({ queryKey: ["jobs"] });
                Toast.success("Job is being retried");
              } catch (e) {
                console.error("Could not retry job", e);
                Toast.error("Failed to start retrying the job");
              }
            }}
            icon={<PlayCircleOutlined className="icon-margin-right" />}
          >
            Retry
          </AsyncLink>
        </Tooltip>
      );
    } else if (
      job.command === APIJobCommand.CONVERT_TO_WKW ||
      job.command === APIJobCommand.COMPUTE_SEGMENT_INDEX_FILE ||
      job.command === APIJobCommand.ALIGN_SECTIONS
    ) {
      return (
        <span>
          {job.resultLink && (
            <Link to={job.resultLink} title="View Dataset">
              <LinkButton icon={<EyeOutlined />}>View</LinkButton>
            </Link>
          )}
        </span>
      );
    } else if (job.command === APIJobCommand.EXPORT_TIFF) {
      return (
        <span>
          {job.resultLink && (
            <LinkButton href={job.resultLink} icon={<DownloadOutlined />}>
              Download
            </LinkButton>
          )}
        </span>
      );
    } else if (job.command === APIJobCommand.RENDER_ANIMATION) {
      return (
        <span>
          {job.resultLink && (
            <LinkButton href={job.resultLink} icon={<DownloadOutlined />}>
              Download
            </LinkButton>
          )}
        </span>
      );
    } else if (job.command === APIJobCommand.FIND_LARGEST_SEGMENT_ID) {
      return <span>{job.returnValue}</span>;
    } else if (
      job.command === APIJobCommand.INFER_NUCLEI ||
      job.command === APIJobCommand.INFER_NEURONS ||
      job.command === APIJobCommand.MATERIALIZE_VOLUME_ANNOTATION ||
      job.command === APIJobCommand.COMPUTE_MESH_FILE ||
      job.command === APIJobCommand.DEPRECATED_INFER_WITH_MODEL ||
      job.command === APIJobCommand.INFER_MITOCHONDRIA ||
      job.command === APIJobCommand.INFER_INSTANCES
    ) {
      return (
        <span>
          {job.resultLink && (
            <Link to={job.resultLink} title="View Segmentation">
              <EyeOutlined className="icon-margin-right" />
              View
            </Link>
          )}
        </span>
      );
    } else if (
      job.command === APIJobCommand.TRAIN_NEURON_MODEL ||
      job.command === APIJobCommand.DEPRECATED_TRAIN_MODEL
    ) {
      return (
        <span>
          {job.state === "SUCCESS" &&
            "The model may now be selected from the “AI Analysis“ button when viewing a dataset."}
        </span>
      );
    } else {
      // unknown job type
      return (
        <span>
          {job.resultLink && (
            <LinkButton href={job.resultLink} icon={<DownloadOutlined />}>
              Result
            </LinkButton>
          )}
          {job.returnValue && <p>{job.returnValue}</p>}
        </span>
      );
    }
  }

  function renderState(__: any, job: APIJob) {
    return <JobState job={job} />;
  }

  return (
    <div className="container">
      <Flex justify="space-between" align="baseline" style={{ marginBottom: 20 }}>
        <div>
          <h3>Jobs</h3>
          <Typography.Paragraph type="secondary">
            Some actions such as dataset conversions or export as Tiff files require some time for
            processing in the background.
            <a
              href="https://docs.webknossos.org/webknossos/automation/jobs.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Tooltip title="Read more in the documentation">
                <InfoCircleOutlined className="icon-margin-left" />
              </Tooltip>
            </a>
            <br />
            WEBKNOSSOS will notify you via email when a background job has finished. Alternatively,
            reload this page to track the progress.
          </Typography.Paragraph>
        </div>
        <Search
          style={{
            width: 200,
          }}
          onChange={handleSearch}
          value={searchQuery}
        />
      </Flex>
      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={Utils.filterWithSearchQueryAND(
            jobs || [],
            [(job) => job.args.datasetName || ""],
            searchQuery,
          )}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
          }}
          style={{
            marginTop: 30,
          }}
        >
          <Column
            title="Job Id"
            dataIndex="id"
            key="id"
            width={120}
            render={(id) => <FormattedId id={id} />}
            sorter={Utils.localeCompareBy<APIJob>((job) => job.id)}
          />
          <Column title="Description" key="datasetName" render={renderDescription} />
          <Column
            title="Owner"
            key="owner"
            sorter={Utils.localeCompareBy<APIJob>((job) => job.ownerLastName)}
            render={(job: APIJob) => (
              <>
                <div>{`${job.ownerLastName}, ${job.ownerFirstName}`}</div>
                <div>{`(${job.ownerEmail})`}</div>
              </>
            )}
          />
          <Column
            title="Cost in Credits"
            key="creditCost"
            render={(job: APIJob) => (job.creditCost ? formatCreditsString(job.creditCost) : "-")}
          />
          <Column
            title="Date"
            key="createdAt"
            width={190}
            render={(job) => <FormattedDate timestamp={job.created} />}
            sorter={Utils.compareBy<APIJob>((job) => job.created)}
            defaultSortOrder="descend"
          />
          {isCurrentUserSuperUser ? (
            <Column title="Voxelytics" key="workflow" width={150} render={renderWorkflowLink} />
          ) : null}
          <Column
            title="State"
            key="state"
            width={120}
            render={renderState}
            sorter={Utils.localeCompareBy<APIJob>((job) => job.state)}
          />
          <Column title="Action" key="actions" fixed="right" width={150} render={renderActions} />
        </Table>
      </Spin>
    </div>
  );
}

export default JobListView;
