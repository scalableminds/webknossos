import _ from "lodash";
import { PropTypes } from "@scalableminds/prop-types";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { Link } from "react-router-dom";
import { Table, Spin, Input, Tooltip, Typography } from "antd";
import {
  CheckCircleTwoTone,
  ClockCircleTwoTone,
  CloseCircleTwoTone,
  CloseCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  LoadingOutlined,
  QuestionCircleTwoTone,
  InfoCircleOutlined,
} from "@ant-design/icons";
import * as React from "react";
import { APIJob, APIJobType } from "types/api_flow_types";
import { getJobs, cancelJob } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import FormattedDate from "components/formatted_date";
import { AsyncLink } from "components/async_clickables";
import { useEffect, useState } from "react";
import { useInterval } from "libs/react_helpers";

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

  function renderDescription(__: any, job: APIJob) {
    if (job.type === APIJobType.CONVERT_TO_WKW && job.datasetName) {
      return <span>{`Conversion to WKW of ${job.datasetName}`}</span>;
    } else if (job.type === APIJobType.EXPORT_TIFF && job.organizationName && job.datasetName) {
      const labelToAnnotationOrDataset =
        job.annotationId != null ? (
          <Link to={`/annotations/${job.annotationId}`}>
            annotation of dataset {job.datasetName}
          </Link>
        ) : (
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            dataset {job.datasetName}
          </Link>
        );
      const layerLabel = job.annotationLayerName || job.layerName;
      return (
        <span>
          Tiff export of layer {layerLabel} from {labelToAnnotationOrDataset} (Bounding Box{" "}
          {job.boundingBox})
        </span>
      );
    } else if (
      job.type === APIJobType.RENDER_ANIMATION &&
      job.organizationName &&
      job.datasetName
    ) {
      return (
        <span>
          Animation rendering for layer {job.layerName} of dataset{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>
        </span>
      );
    } else if (
      job.type === APIJobType.COMPUTE_MESH_FILE &&
      job.organizationName &&
      job.datasetName
    ) {
      return (
        <span>
          Mesh file computation for{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>{" "}
        </span>
      );
    } else if (
      job.type === APIJobType.COMPUTE_SEGMENT_INDEX_FILE &&
      job.organizationName &&
      job.datasetName
    ) {
      return (
        <span>
          Segment index file computation for{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>{" "}
        </span>
      );
    } else if (
      job.type === APIJobType.FIND_LARGEST_SEGMENT_ID &&
      job.organizationName &&
      job.datasetName &&
      job.layerName
    ) {
      return (
        <span>
          Largest segment id detection for layer {job.layerName} of{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>{" "}
        </span>
      );
    } else if (
      job.type === APIJobType.INFER_NUCLEI &&
      job.organizationName &&
      job.datasetName &&
      job.layerName
    ) {
      return (
        <span>
          Nuclei inferral for layer {job.layerName} of{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>{" "}
        </span>
      );
    } else if (
      job.type === APIJobType.INFER_NEURONS &&
      job.organizationName &&
      job.datasetName &&
      job.layerName
    ) {
      return (
        <span>
          Neuron inferral for layer {job.layerName} of{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>{" "}
        </span>
      );
    } else if (
      job.type === APIJobType.MATERIALIZE_VOLUME_ANNOTATION &&
      job.organizationName &&
      job.datasetName
    ) {
      return (
        <span>
          Materialize annotation for {job.layerName ? ` layer ${job.layerName} of ` : " "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>
          {job.mergeSegments
            ? ". This includes merging the segments that were merged via merger mode."
            : null}
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
          icon={<CloseCircleOutlined key="cancel" className="icon-margin-right" />}
        >
          Cancel
        </AsyncLink>
      );
    } else if (
      job.type === APIJobType.CONVERT_TO_WKW ||
      job.type === APIJobType.COMPUTE_SEGMENT_INDEX_FILE
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
      job.type === APIJobType.INFER_WITH_MODEL
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
    } else if (job.type === APIJobType.TRAIN_MODEL) {
      return (
        <span>
          The model may now be selected from the &quot;AI Analysis&quot; button when viewing a
          dataset.
        </span>
      );
    } else {
      // The above if-branches should be exhaustive over all job types
      Utils.assertNever(job.type);
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
          href="https://docs.webknossos.org/webknossos/jobs.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Tooltip title="Read more in the documentation">
            <InfoCircleOutlined style={{ marginLeft: 10 }} />
          </Tooltip>
        </a>
        <br />
        WEBKNOSSOS will notfiy you via email when a job has finished or reload this page to track
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
