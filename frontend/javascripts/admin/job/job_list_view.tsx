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
import { cancelJob, getJobs, retryJob } from "admin/rest_api";
import { Input, Modal, Spin, Table, Tooltip, Typography } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { formatCreditsString, formatWkLibsNdBBox } from "libs/format_utils";
import Persistence from "libs/persistence";
import { useInterval } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type APIJob, APIJobCommand } from "types/api_types";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";

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
  trainingAnnotations: {
    annotationId: string;
  }[],
) => {
  return trainingAnnotations == null ? null : trainingAnnotations.length > 1 ? (
    <a
      href="#"
      onClick={() => {
        Modal.info({
          content: (
            <div>
              The following annotations were used during training:
              <ul>
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
    </a>
  ) : (
    <a
      href={`/annotations/${trainingAnnotations[0].annotationId}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      Show Training Data
    </a>
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
  const [isLoading, setIsLoading] = useState(true);
  const [jobs, setJobs] = useState<APIJob[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const isCurrentUserSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);

  useEffect(() => {
    initialize();
  }, []);

  async function initialize() {
    await fetchData();
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
    setIsLoading(false);
  }

  async function fetchData() {
    setJobs(await getJobs());
  }

  useInterval(async () => {
    setJobs(await getJobs());
  }, refreshInterval);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function getLinkToDataset(job: APIJob) {
    // prefer updated link over legacy link.
    if (job.args.datasetId != null)
      return `/datasets/${getReadableURLPart({ name: job.args.datasetName || "unknown_name", id: job.args.datasetId })}/view`;
    if (
      job.organizationId != null &&
      (job.args.datasetName != null || job.args.datasetDirectoryName != null)
    )
      return `/datasets/${job.organizationId}/${job.args.datasetDirectoryName || job.args.datasetName}/view`;
    return null;
  }

  function renderDescription(__: any, job: APIJob) {
    const linkToDataset = getLinkToDataset(job);
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
      const layerLabel = job.args.annotationLayerName || job.args.layerName;
      return (
        <span>
          Tiff export of layer {layerLabel} from {labelToAnnotationOrDataset} (Bounding Box{" "}
          {job.args.ndBoundingBox
            ? formatWkLibsNdBBox(job.args.ndBoundingBox)
            : job.args.boundingBox}
          )
        </span>
      );
    } else if (job.command === APIJobCommand.RENDER_ANIMATION && linkToDataset != null) {
      return (
        <span>
          Animation rendering for layer {job.args.layerName} of dataset{" "}
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
      job.args.layerName
    ) {
      return (
        <span>
          Largest segment id detection for layer {job.args.layerName} of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.INFER_NUCLEI &&
      linkToDataset != null &&
      job.args.layerName
    ) {
      return (
        <span>
          Nuclei inferral for layer {job.args.layerName} of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.INFER_NEURONS &&
      linkToDataset != null &&
      job.args.layerName &&
      job.args.modelId == null
    ) {
      return (
        <span>
          AI Neuron inferral for layer <i>{job.args.layerName}</i> of{" "}
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
      job.args.layerName
    ) {
      return (
        <span>
          AI Mitochondria inferral for layer <i>{job.args.layerName}</i> of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.INFER_INSTANCES &&
      linkToDataset != null &&
      job.args.layerName
    ) {
      return (
        <span>
          AI instance segmentation for layer <i>{job.args.layerName}</i> of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.ALIGN_SECTIONS &&
      linkToDataset != null &&
      job.args.layerName
    ) {
      return (
        <span>
          Align sections for layer <i>{job.args.layerName}</i> of{" "}
          <Link to={linkToDataset}>{job.args.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.command === APIJobCommand.MATERIALIZE_VOLUME_ANNOTATION &&
      linkToDataset != null
    ) {
      return (
        <span>
          Materialize annotation for {job.args.layerName ? ` layer ${job.args.layerName} of ` : " "}
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
          {getShowTrainingDataLink(job.args.trainingAnnotations)}
        </span>
      );
    } else {
      return <span>{job.command}</span>;
    }
  }

  function renderWorkflowLink(__: any, job: APIJob) {
    return job.voxelyticsWorkflowHash != null ? (
      <Link to={`/workflows/${job.voxelyticsWorkflowHash}`}>Voxelytics Report</Link>
    ) : null;
  }

  function renderActions(__: any, job: APIJob) {
    if (job.state === "PENDING" || job.state === "STARTED") {
      return (
        <AsyncLink
          href="#"
          onClick={async () => {
            const isDeleteConfirmed = await confirmAsync({
              title: <p>Are you sure you want to cancel job {job.id}?</p>,
              okText: "Yes, cancel job",
              cancelText: "No, keep it",
            });

            if (isDeleteConfirmed) {
              cancelJob(job.id).then(() => fetchData());
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
            href="#"
            onClick={async () => {
              try {
                await retryJob(job.id);
                await fetchData();
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
              <EyeOutlined className="icon-margin-right" />
              View
            </Link>
          )}
        </span>
      );
    } else if (job.command === APIJobCommand.EXPORT_TIFF) {
      return (
        <span>
          {job.resultLink && (
            <a href={job.resultLink} title="Download">
              <DownloadOutlined className="icon-margin-right" />
              Download
            </a>
          )}
        </span>
      );
    } else if (job.command === APIJobCommand.RENDER_ANIMATION) {
      return (
        <span>
          {job.resultLink && (
            <a href={job.resultLink} title="Download">
              <DownloadOutlined className="icon-margin-right" />
              Download
            </a>
          )}
        </span>
      );
    } else if (job.command === "find_largest_segment_id") {
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
            <a href={job.resultLink} title="Result">
              Result
            </a>
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
      <div className="pull-right">
        <Search
          style={{
            width: 200,
          }}
          onChange={handleSearch}
          value={searchQuery}
        />
      </div>
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
            <InfoCircleOutlined style={{ marginLeft: 10 }} />
          </Tooltip>
        </a>
        <br />
        WEBKNOSSOS will notify you via email when a job has finished or reload this page to track
        progress.
      </Typography.Paragraph>
      <div
        className="clearfix"
        style={{
          margin: "20px 0px",
        }}
      />
      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={Utils.filterWithSearchQueryAND(
            jobs,
            [(job) => job.args.datasetName || ""],
            searchQuery,
          )}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
          }}
          style={{
            marginTop: 30,
            marginBottom: 30,
          }}
        >
          <Column
            title="Job Id"
            dataIndex="id"
            key="id"
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
            render={(job) => <FormattedDate timestamp={job.created} />}
            sorter={Utils.compareBy<APIJob>((job) => job.created)}
            defaultSortOrder="descend"
          />
          {isCurrentUserSuperUser ? (
            <Column title="Workflow" key="workflow" width={150} render={renderWorkflowLink} />
          ) : null}
          <Column
            title="State"
            key="state"
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
