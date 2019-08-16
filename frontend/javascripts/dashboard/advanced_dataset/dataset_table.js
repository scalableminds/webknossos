// @flow

import { Table, Icon, Tag } from "antd";
import * as React from "react";
import _ from "lodash";
import { Link } from "react-router-dom";
import dice from "dice-coefficient";
import ReactDOM from "react-dom";

import type { APITeam, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import { stringToColor, formatScale } from "libs/format_utils";
import DatasetAccessListView from "dashboard/advanced_dataset/dataset_access_list_view";
import DatasetActionView from "dashboard/advanced_dataset/dataset_action_view";
import FormattedDate from "components/formatted_date";
import { getDatasetExtentAsString } from "oxalis/model/accessors/dataset_accessor";
import * as Utils from "libs/utils";
import type { DatasetFilteringMode } from "../dataset_view";

const { Column } = Table;

const typeHint: APIMaybeUnimportedDataset[] = [];
const useLruRank = true;

type Props = {
  datasets: Array<APIMaybeUnimportedDataset>,
  searchQuery: string,
  isUserAdmin: boolean,
  datasetFilteringMode: DatasetFilteringMode,
};

type State = {
  prevSearchQuery: string,
  sortedInfo: Object,
};

class DatasetTable extends React.PureComponent<Props, State> {
  state = {
    sortedInfo: {
      columnKey: useLruRank ? "" : "created",
      order: "descend",
    },
    prevSearchQuery: "",
  };

  static getDerivedStateFromProps(nextProps: Props, prevState: State): $Shape<State> {
    const maybeSortedInfo =
      // Clear the sorting exactly when the search box is initially filled
      // (searchQuery changes from empty string to non-empty string)
      nextProps.searchQuery !== "" && prevState.prevSearchQuery === ""
        ? {
            sortedInfo: { columnKey: null, order: "ascend" },
          }
        : {};

    return {
      prevSearchQuery: nextProps.searchQuery,
      ...maybeSortedInfo,
    };
  }

  async componentDidMount() {
    const table = document.getElementById("dataset-table");
    const tableBody = table.querySelector(".ant-table-body");
    const tableContent = tableBody.firstChild;
    // works HYPE
    // trigger rerendering of arrow indicator when receiving event
    // !! throttle this with lodash !!
    // here create the two indicators
    const indicatorContainer = document.createElement("div");
    indicatorContainer.classList.add("indicator-container");
    tableBody.appendChild(indicatorContainer);
    ReactDOM.render(
      <React.Fragment>
        <div className="scrolling-indicator left-scrolling-indicator" />
        <div className="scrolling-indicator right-scrolling-indicator" />
      </React.Fragment>,
      indicatorContainer,
    );

    tableBody.addEventListener(
      "scroll",
      _.throttle(
        () => this.updateScrollingIndicators(tableContent, tableBody, indicatorContainer),
        100,
      ),
    );
    // Intial call to set is[Left/Right]ScrollingIndicatorVisible correctly.
    // But we need to wait for React to actually render the indicators.
    setTimeout(
      () => this.updateScrollingIndicators(tableContent, tableBody, indicatorContainer),
      200,
    );
  }

  updateScrollingIndicators = (
    content: DOMElement,
    container: DOMElement,
    indicatorContainer: DOMElement,
  ) => {
    const leftIndicator = indicatorContainer.getElementsByClassName("left-scrolling-indicator")[0];
    const rightIndicator = indicatorContainer.getElementsByClassName(
      "right-scrolling-indicator",
    )[0];
    if (!leftIndicator || !rightIndicator) {
      return;
    }
    const isOverflowing = this.determineOverflow(content, container);
    const mapBooleanToString = { true: "visible", false: "hidden" };
    leftIndicator.style.visibility = mapBooleanToString[isOverflowing.left];
    rightIndicator.style.visibility = mapBooleanToString[isOverflowing.right];
  };

  determineOverflow(content: DOMElement, container: DOMElement) {
    const containerMetrics = container.getBoundingClientRect();
    const containerMetricsRight = Math.floor(containerMetrics.right);
    const containerMetricsLeft = Math.floor(containerMetrics.left);
    const contentMetrics = content.getBoundingClientRect();
    const contentMetricsRight = Math.floor(contentMetrics.right);
    const contentMetricsLeft = Math.floor(contentMetrics.left);
    const isOverflowing = { left: false, right: false };
    if (containerMetricsLeft > contentMetricsLeft) {
      isOverflowing.left = true;
    }
    if (containerMetricsRight < contentMetricsRight) {
      isOverflowing.right = true;
    }
    return isOverflowing;
  }

  handleChange = (pagination: Object, filters: Object, sorter: Object) => {
    this.setState({
      sortedInfo: sorter,
    });
  };

  getFilteredDatasets() {
    const filterByMode = datasets => {
      const { datasetFilteringMode } = this.props;
      if (datasetFilteringMode === "onlyShowReported") {
        return datasets.filter(el => !el.isUnreported);
      } else if (datasetFilteringMode === "onlyShowUnreported") {
        return datasets.filter(el => el.isUnreported);
      } else {
        return datasets;
      }
    };

    const filterByQuery = datasets =>
      Utils.filterWithSearchQueryAND<APIMaybeUnimportedDataset, "name" | "description">(
        datasets,
        ["name", "description"],
        this.props.searchQuery,
      );

    const filterByHasLayers = datasets =>
      this.props.isUserAdmin
        ? datasets
        : datasets.filter(dataset => dataset.dataSource.dataLayers != null);

    return filterByQuery(filterByMode(filterByHasLayers(this.props.datasets)));
  }

  renderEmptyText() {
    const maybeWarning =
      this.props.datasetFilteringMode !== "showAllDatasets"
        ? "Note that datasets are currently filtered according to whether they are available on the datastore. You can change the filtering via the menu next to the search input."
        : null;

    return <span>No Datasets found. {maybeWarning}</span>;
  }

  render() {
    const { isUserAdmin } = this.props;
    const filteredDataSource = this.getFilteredDatasets();

    const { sortedInfo } = this.state;
    const dataSourceSortedByRank = useLruRank
      ? _.sortBy(filteredDataSource, ["lastUsedByUser", "created"]).reverse()
      : filteredDataSource;

    // Create a map from dataset to its rank
    const datasetToRankMap: Map<APIMaybeUnimportedDataset, number> = new Map(
      dataSourceSortedByRank.map((dataset, rank) => [dataset, rank]),
    );

    const sortedDataSource =
      // Sort using the dice coefficient if the table is not sorted otherwise
      // and if the query is longer then 3 characters to avoid sorting *all* datasets
      this.props.searchQuery.length > 3 && sortedInfo.columnKey == null
        ? _.chain(filteredDataSource)
            .map(dataset => {
              const diceCoefficient = dice(dataset.name, this.props.searchQuery);
              const rank = useLruRank ? datasetToRankMap.get(dataset) || 0 : 0;
              const rankCoefficient = 1 - rank / filteredDataSource.length;
              const coefficient = (diceCoefficient + rankCoefficient) / 2;
              return {
                dataset,
                coefficient,
              };
            })
            .sortBy("coefficient")
            .map(({ dataset }) => dataset)
            .reverse()
            .value()
        : dataSourceSortedByRank;

    return (
      <Table
        dataSource={sortedDataSource}
        rowKey="name"
        pagination={{
          defaultPageSize: 50,
        }}
        expandedRowRender={
          isUserAdmin ? dataset => <DatasetAccessListView dataset={dataset} /> : null
        }
        onChange={this.handleChange}
        locale={{ emptyText: this.renderEmptyText() }}
        className="large-table"
        id="dataset-table"
      >
        <Column
          title="Name"
          dataIndex="name"
          key="name"
          width={280}
          sorter={Utils.localeCompareBy(typeHint, dataset => dataset.name)}
          sortOrder={sortedInfo.columnKey === "name" && sortedInfo.order}
          render={(name: string, dataset: APIMaybeUnimportedDataset) => (
            <div>
              <Link
                to={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
                title="View Dataset"
                style={{ color: "rgba(0, 0, 0, 0.65)" }}
              >
                {dataset.name}
              </Link>
              <br />
              <Tag color={stringToColor(dataset.dataStore.name)}>{dataset.dataStore.name}</Tag>
            </div>
          )}
        />
        <Column
          width={150}
          title="Creation Date"
          dataIndex="created"
          key="created"
          sorter={Utils.compareBy(typeHint, dataset => dataset.created)}
          sortOrder={sortedInfo.columnKey === "created" && sortedInfo.order}
          render={created => <FormattedDate timestamp={created} />}
        />
        <Column
          title="Scale & Extent"
          dataIndex="scale"
          key="scale"
          width={280}
          render={(__, dataset: APIMaybeUnimportedDataset) =>
            `${formatScale(dataset.dataSource.scale)}  ${getDatasetExtentAsString(dataset)}`
          }
        />

        <Column
          title="Allowed Teams"
          dataIndex="allowedTeams"
          key="allowedTeams"
          width={150}
          render={(teams: Array<APITeam>, dataset: APIMaybeUnimportedDataset) =>
            teams.map(team => (
              <Tag
                color={stringToColor(team.name)}
                key={`allowed_teams_${dataset.name}_${team.name}`}
              >
                {team.name}
              </Tag>
            ))
          }
        />
        <Column
          title="Active"
          dataIndex="isActive"
          key="isActive"
          width={100}
          sorter={(a, b) => a.isActive - b.isActive}
          sortOrder={sortedInfo.columnKey === "isActive" && sortedInfo.order}
          render={(isActive: boolean) => {
            const icon = isActive ? "check-circle-o" : "close-circle-o";
            return <Icon type={icon} style={{ fontSize: 20 }} />;
          }}
        />
        <Column
          title="Public"
          dataIndex="isPublic"
          key="isPublic"
          width={100}
          sorter={(a, b) => a.isPublic - b.isPublic}
          sortOrder={sortedInfo.columnKey === "isPublic" && sortedInfo.order}
          render={(isPublic: boolean) => {
            const icon = isPublic ? "check-circle-o" : "close-circle-o";
            return <Icon type={icon} style={{ fontSize: 20 }} />;
          }}
        />
        <Column
          title="Data Layers"
          width={200}
          dataIndex="dataSource.dataLayers"
          render={(__, dataset: APIMaybeUnimportedDataset) =>
            (dataset.dataSource.dataLayers || []).map(layer => (
              <Tag key={layer.name}>
                {layer.category} - {layer.elementClass}
              </Tag>
            ))
          }
        />

        <Column
          width={200}
          title="Actions"
          key="actions"
          render={(__, dataset: APIMaybeUnimportedDataset) => (
            <DatasetActionView isUserAdmin={isUserAdmin} dataset={dataset} />
          )}
        />
      </Table>
    );
  }
}

export default DatasetTable;
