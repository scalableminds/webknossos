// @flow
import _ from "lodash";

import { PropTypes } from "@scalableminds/prop-types";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { Table, Spin, Input, Tooltip } from "antd";
import {
  CheckCircleTwoTone,
  ClockCircleTwoTone,
  CloseCircleTwoTone,
  DownOutlined,
  EyeOutlined,
  LoadingOutlined,
  QuestionCircleTwoTone,
  ToolTwoTone,
} from "@ant-design/icons";
import { connect } from "react-redux";
import * as React from "react";

import type { APIJob, APIUser } from "types/api_flow_types";
import { getJobs } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import type { OxalisState } from "oxalis/store";
import FormattedDate from "components/formatted_date";

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
  STARTED: { tooltip: "This job is currently running.", icon: <LoadingOutlined /> },
  FAILURE: {
    tooltip:
      "Something went wrong when executing this job. Feel free to contact us if you need assistance.",
    icon: <CloseCircleTwoTone twoToneColor="#a61d24" />,
  },
  MANUAL: {
    tooltip:
      "The job will be handled by an admin shortly, since it could not be finished automatically. Please check back here soon.",
    icon: <ToolTwoTone twoToneColor="#d89614" />,
  },
};

const refreshInterval = 5000;

const { Column } = Table;
const { Search } = Input;

const typeHint: APIJob[] = [];

type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = { ...StateProps, history: RouterHistory };

type State = {
  isLoading: boolean,
  jobs: Array<APIJob>,
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "jobList",
);

class JobListView extends React.PureComponent<Props, State> {
  intervalID: ?TimeoutID;

  state = {
    isLoading: true,
    jobs: [],
    searchQuery: "",
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
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
      },
      // refresh jobs according to the refresh interval
      () => {
        this.intervalID = setTimeout(this.fetchData.bind(this), refreshInterval);
      },
    );
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renderDescription = (__: any, job: APIJob) => {
    if (job.type === "convert_to_wkw" && job.datasetName) {
      return <span>{`Conversion to WKW of ${job.datasetName}`}</span>;
    } else if (job.type === "export_tiff" && job.organizationName && job.datasetName) {
      const volumeAnnotationLabel =
        job.annotationId != null ? (
          <Link to={`/annotations/${job.annotationType || "Explorational"}/${job.annotationId}`}>
            volume annotation
          </Link>
        ) : (
          "volume annotation"
        );
      const layerLabel = job.tracingId != null ? volumeAnnotationLabel : job.layerName || "a";
      return (
        <span>
          Tiff export from {layerLabel} layer of{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>{" "}
          (Bounding Box {job.boundingBox})
        </span>
      );
    } else if (job.type === "compute_mesh_file" && job.organizationName && job.datasetName) {
      return (
        <span>
          Mesh file computation for{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>{" "}
        </span>
      );
    } else if (
      job.type === "infer_nuclei" &&
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
    } else {
      return <span>{job.type}</span>;
    }
  };

  renderActions = (__: any, job: APIJob) => {
    if (job.type === "convert_to_wkw") {
      return (
        <span>
          {job.state === "SUCCESS" && job.datasetName && this.props.activeUser && (
            <Link
              to={`/datasets/${this.props.activeUser.organization}/${job.datasetName}/view`}
              title="View Dataset"
            >
              <EyeOutlined />
              View
            </Link>
          )}
        </span>
      );
    } else if (job.type === "export_tiff") {
      return (
        <span>
          {job.state === "SUCCESS" && job.exportFileName && this.props.activeUser && (
            <a href={`/api/jobs/${job.id}/downloadExport/${job.exportFileName}`} title="Download">
              <DownOutlined />
              Download
            </a>
          )}
        </span>
      );
    } else if (job.type === "infer_nuclei") {
      return (
        <span>
          {job.state === "SUCCESS" && job.result && this.props.activeUser && (
            <Link
              to={`/datasets/${this.props.activeUser.organization}/${job.result}/view`}
              title="View Segmentation"
            >
              <EyeOutlined />
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
        <div style={{ marginTag: 20 }}>
          <div className="pull-right">
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
              value={this.state.searchQuery}
            />
          </div>
          <h3>Jobs</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

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
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Column
                title="Job Id"
                dataIndex="id"
                key="id"
                sorter={Utils.localeCompareBy(typeHint, job => job.id)}
              />
              <Column title="Description" key="datasetName" render={this.renderDescription} />
              <Column
                title="Created at"
                key="createdAt"
                render={job => <FormattedDate timestamp={job.createdAt} />}
                sorter={Utils.compareBy(typeHint, job => job.createdAt)}
              />
              <Column
                title="State"
                key="state"
                render={this.renderState}
                sorter={Utils.localeCompareBy(typeHint, job => job.state)}
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
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<StateProps, {||}, _, _, _, _>(mapStateToProps)(withRouter(JobListView));
