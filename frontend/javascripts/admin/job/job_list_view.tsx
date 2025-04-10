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
import { cancelJob, getJobs, retryJob } from "admin/admin_rest_api";
import { Input, Modal, Spin, Table, Tooltip, Typography } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { formatCreditsString, formatWkLibsNdBBox } from "libs/format_utils";
import Persistence from "libs/persistence";
import { useInterval } from "libs/react_helpers";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import { getReadableURLPart } from "oxalis/model/accessors/dataset_accessor";
import type { OxalisState } from "oxalis/store";
import type * as React from "react";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { type APIJob, APIJobType, type APIUserBase } from "types/api_flow_types";

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
      <span className="icon-margin-right">{icon}</span>
      {jobStateNormalized}
    </Tooltip>
  );
}

function JobListView() {
  const [isLoading, setIsLoading] = useState(true);
  const [jobs, setJobs] = useState<APIJob[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const isCurrentUserSuperUser = useSelector((state: OxalisState) => state.activeUser?.isSuperUser);

  useEffect(() => {
    fetchData();
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
    setIsLoading(false);
  }, []);

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
    if (job.datasetId != null)
      return `/datasets/${getReadableURLPart({ name: job.datasetName || "unknown_name", id: job.datasetId })}/view`;
    if (job.organizationId != null && (job.datasetName != null || job.datasetDirectoryName != null))
      return `/datasets/${job.organizationId}/${job.datasetDirectoryName || job.datasetName}/view`;
    return null;
  }

  function renderDescription(__: any, job: APIJob) {
    const linkToDataset = getLinkToDataset(job);
    if (job.type === APIJobType.CONVERT_TO_WKW && job.datasetName) {
      return <span>{`Conversion to WKW of ${job.datasetName}`}</span>;
    } else if (job.type === APIJobType.EXPORT_TIFF && linkToDataset != null) {
      const labelToAnnotationOrDataset =
        job.annotationId != null ? (
          <Link to={`/annotations/${job.annotationId}`}>
            annotation of dataset {job.datasetName}
          </Link>
        ) : (
          <Link to={linkToDataset}>dataset {job.datasetName}</Link>
        );
      const layerLabel = job.annotationLayerName || job.layerName;
      return (
        <span>
          Tiff export of layer {layerLabel} from {labelToAnnotationOrDataset} (Bounding Box{" "}
          {job.ndBoundingBox ? formatWkLibsNdBBox(job.ndBoundingBox) : job.boundingBox})
        </span>
      );
    } else if (job.type === APIJobType.RENDER_ANIMATION && linkToDataset != null) {
      return (
        <span>
          Animation rendering for layer {job.layerName} of dataset{" "}
          <Link to={linkToDataset}>{job.datasetName}</Link>
        </span>
      );
    } else if (job.type === APIJobType.COMPUTE_MESH_FILE && linkToDataset != null) {
      return (
        <span>
          Mesh file computation for <Link to={linkToDataset}>{job.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.type === APIJobType.COMPUTE_SEGMENT_INDEX_FILE && linkToDataset != null) {
      return (
        <span>
          Segment index file computation for <Link to={linkToDataset}>{job.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.type === APIJobType.FIND_LARGEST_SEGMENT_ID &&
      linkToDataset != null &&
      job.layerName
    ) {
      return (
        <span>
          Largest segment id detection for layer {job.layerName} of{" "}
          <Link to={linkToDataset}>{job.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.type === APIJobType.INFER_NUCLEI && linkToDataset != null && job.layerName) {
      return (
        <span>
          Nuclei inferral for layer {job.layerName} of{" "}
          <Link to={linkToDataset}>{job.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.type === APIJobType.INFER_NEURONS && linkToDataset != null && job.layerName) {
      return (
        <span>
          Neuron inferral for layer {job.layerName} of{" "}
          <Link to={linkToDataset}>{job.datasetName}</Link>{" "}
        </span>
      );
    } else if (
      job.type === APIJobType.INFER_MITOCHONDRIA &&
      linkToDataset != null &&
      job.layerName
    ) {
      return (
        <span>
          Mitochondria inferral for layer {job.layerName} of{" "}
          <Link to={linkToDataset}>{job.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.type === APIJobType.ALIGN_SECTIONS && linkToDataset != null && job.layerName) {
      return (
        <span>
          Align sections for layer {job.layerName} of{" "}
          <Link to={linkToDataset}>{job.datasetName}</Link>{" "}
        </span>
      );
    } else if (job.type === APIJobType.MATERIALIZE_VOLUME_ANNOTATION && linkToDataset != null) {
      return (
        <span>
          Materialize annotation for {job.layerName ? ` layer ${job.layerName} of ` : " "}
          <Link to={linkToDataset}>{job.datasetName}</Link>
          {job.mergeSegments
            ? ". This includes merging the segments that were merged via merger mode."
            : null}
        </span>
      );
    } else if (job.type === APIJobType.TRAIN_NEURON_MODEL) {
      const numberOfTrainingAnnotations = job.trainingAnnotations.length;
      return (
        <span>
          {`Train model on ${numberOfTrainingAnnotations} ${Utils.pluralize("annotation", numberOfTrainingAnnotations)}. `}
          {getShowTrainingDataLink(job.trainingAnnotations)}
        </span>
      );
    } else if (job.type === APIJobType.DEPRECATED_INFER_WITH_MODEL && linkToDataset != null) {
      return (
        <span>
          Run AI segmentation with custom model on <Link to={linkToDataset}>{job.datasetName}</Link>
        </span>
      );
    } else {
      return <span>{job.type}</span>;
    }
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
    } else if (job.state === "FAILURE" && isCurrentUserSuperUser) {
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
      job.type === APIJobType.CONVERT_TO_WKW ||
      job.type === APIJobType.COMPUTE_SEGMENT_INDEX_FILE ||
      job.type === APIJobType.ALIGN_SECTIONS
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
    } else if (job.type === APIJobType.EXPORT_TIFF) {
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
    } else if (job.type === APIJobType.RENDER_ANIMATION) {
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
    } else if (job.type === "find_largest_segment_id") {
      return <span>{job.result}</span>;
    } else if (
      job.type === APIJobType.INFER_NUCLEI ||
      job.type === APIJobType.INFER_NEURONS ||
      job.type === APIJobType.MATERIALIZE_VOLUME_ANNOTATION ||
      job.type === APIJobType.COMPUTE_MESH_FILE ||
      job.type === APIJobType.DEPRECATED_INFER_WITH_MODEL ||
      job.type === APIJobType.INFER_MITOCHONDRIA
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
    } else if (job.type === APIJobType.TRAIN_NEURON_MODEL) {
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
          {job.result && <p>{job.result}</p>}
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
          dataSource={Utils.filterWithSearchQueryAND(jobs, ["datasetName"], searchQuery)}
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
            sorter={Utils.localeCompareBy<APIJob>((job) => job.id)}
          />
          <Column title="Description" key="datasetName" render={renderDescription} />
          <Column
            title="Created at"
            key="createdAt"
            render={(job) => <FormattedDate timestamp={job.createdAt} />}
            sorter={Utils.compareBy<APIJob>((job) => job.createdAt)}
            defaultSortOrder="descend"
          />
          <Column
            title="Owner"
            dataIndex="owner"
            key="owner"
            sorter={Utils.localeCompareBy<APIJob>((job) => job.owner.lastName)}
            render={(owner: APIUserBase) => (
              <>
                <div>{owner.email ? `${owner.lastName}, ${owner.firstName}` : "-"}</div>
                <div>{owner.email ? `(${owner.email})` : "-"}</div>
              </>
            )}
          />
          <Column
            title="State"
            key="state"
            render={renderState}
            sorter={Utils.localeCompareBy<APIJob>((job) => job.state)}
          />
          <Column
            title="Cost in Credits"
            key="creditCost"
            render={(job: APIJob) => (job.creditCost ? formatCreditsString(job.creditCost) : "-")}
          />
          <Column title="Action" key="actions" fixed="right" width={150} render={renderActions} />
        </Table>
      </Spin>
    </div>
  );
}

export default JobListView;
