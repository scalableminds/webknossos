import _ from "lodash";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { Link } from "react-router-dom";
import { Table, Spin, Input, Tooltip, Typography } from "antd";
import {
  CheckCircleTwoTone,
  ClockCircleTwoTone,
  CloseCircleTwoTone,
  CloseCircleOutlined,
  DownOutlined,
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
import { EmptyObject } from "types/globals";
// Unfortunately, the twoToneColor (nor the style) prop don't support
// CSS variables.
export const TOOLTIP_MESSAGES_AND_ICONS = {
  UNKNOWN: {
    tooltip:
      "The status information for this job could not be retreived. Please try again in a few minutes, or contact us if you need assistance.",
    icon: <QuestionCircleTwoTone twoToneColor="#a3a3a3" />,
  },
  SUCCESS: {
    tooltip: "This job has successfully been executed.",
    icon: <CheckCircleTwoTone twoToneColor="#49b21b" />,
  },
  PENDING: {
    tooltip: "This job will run as soon as a worker becomes available.",
    icon: <ClockCircleTwoTone twoToneColor="#d89614" />,
  },
  STARTED: {
    tooltip: "This job is currently running.",
    icon: <LoadingOutlined />,
  },
  FAILURE: {
    tooltip:
      "Something went wrong when executing this job. Feel free to contact us if you need assistance.",
    icon: <CloseCircleTwoTone twoToneColor="#a61d24" />,
  },
  CANCELLED: {
    tooltip: "This job was cancelled.",
    icon: <CloseCircleTwoTone twoToneColor="#aaaaaa" />,
  },
};
const refreshInterval = 5000;
const { Column } = Table;
const { Search } = Input;
const typeHint: APIJob[] = [];
type Props = EmptyObject;
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

class JobListView extends React.PureComponent<Props, State> {
  intervalID: ReturnType<typeof setTimeout> | null | undefined;
  state: State = {
    isLoading: true,
    jobs: [],
    searchQuery: "",
  };

  componentDidMount() {
    // @ts-ignore
    this.setState(persistence.load());
    this.fetchData();
  }

  componentDidUpdate() {
    persistence.persist(this.state);
  }

  componentWillUnmount() {
    if (this.intervalID != null) {
      clearTimeout(this.intervalID);
    }
  }

  async fetchData(): Promise<void> {
    const jobs = await getJobs();
    this.setState(
      {
        isLoading: false,
        jobs,
      }, // refresh jobs according to the refresh interval
      () => {
        if (this.intervalID != null) {
          clearTimeout(this.intervalID);
        }

        this.intervalID = setTimeout(this.fetchData.bind(this), refreshInterval);
      },
    );
  }

  handleSearch = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  renderDescription = (__: any, job: APIJob) => {
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
  };

  renderActions = (__: any, job: APIJob) => {
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
              cancelJob(job.id).then(() => this.fetchData());
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
              <DownOutlined className="icon-margin-right" />
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
              <DownOutlined className="icon-margin-right" />
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
      job.type === APIJobType.COMPUTE_MESH_FILE
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
    } else return null;
  };

  renderState = (__: any, job: APIJob) => {
    const { tooltip, icon } = TOOLTIP_MESSAGES_AND_ICONS[job.state];

    const jobStateNormalized = _.capitalize(job.state.toLowerCase());

    return (
      <Tooltip title={tooltip}>
        {icon}
        {jobStateNormalized}
      </Tooltip>
    );
  };

  render() {
    return (
      <div className="container">
        <div className="pull-right">
          <Search
            style={{
              width: 200,
            }}
            onChange={this.handleSearch}
            value={this.state.searchQuery}
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
        <Spin spinning={this.state.isLoading} size="large">
          <Table
            dataSource={Utils.filterWithSearchQueryAND(
              this.state.jobs,
              ["datasetName"],
              this.state.searchQuery,
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
              sorter={Utils.localeCompareBy(typeHint, (job) => job.id)}
            />
            <Column title="Description" key="datasetName" render={this.renderDescription} />
            <Column
              title="Created at"
              key="createdAt"
              render={(job) => <FormattedDate timestamp={job.createdAt} />}
              sorter={Utils.compareBy(typeHint, (job) => job.createdAt)}
              defaultSortOrder="descend"
            />
            <Column
              title="State"
              key="state"
              render={this.renderState}
              sorter={Utils.localeCompareBy(typeHint, (job) => job.state)}
            />
            <Column
              title="Action"
              key="actions"
              fixed="right"
              width={150}
              render={this.renderActions}
            />
          </Table>
        </Spin>
      </div>
    );
  }
}

export default JobListView;
