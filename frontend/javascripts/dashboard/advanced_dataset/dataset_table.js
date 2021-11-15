// @flow

import { Table, Tag } from "antd";
import * as React from "react";
import { CheckCircleOutlined, CloseCircleOutlined, PlusOutlined } from "@ant-design/icons";
import _ from "lodash";
import { Link } from "react-router-dom";
import dice from "dice-coefficient";
import update from "immutability-helper";

import EditableTextIcon from "oxalis/view/components/editable_text_icon";
import type { APITeam, APIMaybeUnimportedDataset, APIDatasetId } from "types/api_flow_types";
import { stringToColor, formatScale } from "libs/format_utils";
import type { DatasetFilteringMode } from "dashboard/dataset_view";
import DatasetAccessListView from "dashboard/advanced_dataset/dataset_access_list_view";
import DatasetActionView from "dashboard/advanced_dataset/dataset_action_view";
import FormattedDate from "components/formatted_date";
import { getDatasetExtentAsString } from "oxalis/model/accessors/dataset_accessor";
import UserLocalStorage from "libs/user_local_storage";
import FixedExpandableTable from "components/fixed_expandable_table";
import * as Utils from "libs/utils";

const { Column } = Table;

const typeHint: APIMaybeUnimportedDataset[] = [];
const useLruRank = true;
const LOCAL_STORAGE_FILTER_TAGS_KEY = "lastDatasetSearchTags";

type Props = {
  datasets: Array<APIMaybeUnimportedDataset>,
  searchQuery: string,
  isUserAdmin: boolean,
  isUserTeamManager: boolean,
  isUserDatasetManager: boolean,
  datasetFilteringMode: DatasetFilteringMode,
  updateDataset: (APIDatasetId, Array<APIMaybeUnimportedDataset>) => Promise<void>,
};

type State = {
  prevSearchQuery: string,
  sortedInfo: Object,
  filterTags: Array<string>,
};

class DatasetTable extends React.PureComponent<Props, State> {
  state = {
    sortedInfo: {
      columnKey: useLruRank ? "" : "created",
      order: "descend",
    },
    prevSearchQuery: "",
    filterTags: [],
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

  componentDidMount() {
    this.restoreSearchTags();
  }

  handleChange = (pagination: Object, filters: Object, sorter: Object) => {
    this.setState({
      sortedInfo: sorter,
    });
  };

  updateSingleDataset = (datasetId: APIDatasetId): Promise<void> =>
    this.props.updateDataset(datasetId, this.props.datasets);

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

    const filteredByTags = datasets =>
      datasets.filter(dataset => {
        const notIncludedTags = _.difference(this.state.filterTags, dataset.tags);
        return notIncludedTags.length === 0;
      });

    const filterByQuery = datasets =>
      Utils.filterWithSearchQueryAND<APIMaybeUnimportedDataset, "name" | "description">(
        datasets,
        ["name", "description"],
        this.props.searchQuery,
      );

    const filterByHasLayers = datasets =>
      this.props.isUserAdmin || this.props.isUserDatasetManager
        ? datasets
        : datasets.filter(dataset => dataset.isActive && dataset.dataSource.dataLayers.length > 0);

    return filterByQuery(filteredByTags(filterByMode(filterByHasLayers(this.props.datasets))));
  }

  restoreSearchTags() {
    // restore the search query tags from the last session
    const searchTagString = UserLocalStorage.getItem(LOCAL_STORAGE_FILTER_TAGS_KEY);
    if (searchTagString) {
      try {
        const searchTags = JSON.parse(searchTagString);
        this.setState({ filterTags: searchTags });
      } catch (error) {
        // pass
      }
    }
  }

  addTagToSearch = (tag: string): void => {
    if (!this.state.filterTags.includes(tag)) {
      this.setState(prevState => {
        const newTags = update(prevState.filterTags, { $push: [tag] });
        UserLocalStorage.setItem(LOCAL_STORAGE_FILTER_TAGS_KEY, JSON.stringify(newTags));
        return { filterTags: newTags };
      });
    }
  };

  editTagFromDataset = (
    dataset: APIMaybeUnimportedDataset,
    shouldAddTag: boolean,
    tag: string,
    event: SyntheticInputEvent<>,
  ): void => {
    event.stopPropagation(); // prevent the onClick event
    let updatedDataset = dataset;
    if (shouldAddTag) {
      updatedDataset = update(dataset, { tags: { $push: [tag] } });
    } else {
      const newTags = _.without(dataset.tags, tag);
      updatedDataset = update(dataset, { tags: { $set: newTags } });
    }
    this.updateSingleDataset(updatedDataset);
  };

  renderEmptyText() {
    const maybeWarning =
      this.props.datasetFilteringMode !== "showAllDatasets" ? (
        <p>
          Note that datasets are currently filtered according to whether they are available on the
          datastore.
          <br />
          You can change the filtering via the menu next to the search input.
        </p>
      ) : null;

    return (
      <>
        <p>No Datasets found.</p>
        {maybeWarning}
      </>
    );
  }

  render() {
    const { isUserAdmin, isUserTeamManager } = this.props;
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
      <FixedExpandableTable
        dataSource={sortedDataSource}
        rowKey="name"
        pagination={{
          defaultPageSize: 50,
        }}
        expandedRowRender={
          isUserAdmin || isUserTeamManager
            ? dataset => <DatasetAccessListView dataset={dataset} />
            : null
        }
        onChange={this.handleChange}
        locale={{ emptyText: this.renderEmptyText() }}
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
                className="incognito-link"
              >
                {dataset.name}
              </Link>
              <br />
              <Tag color={stringToColor(dataset.dataStore.name)}>{dataset.dataStore.name}</Tag>
            </div>
          )}
        />
        <Column
          title="Tags"
          dataIndex="tags"
          key="tags"
          width={280}
          sortOrder={sortedInfo.columnKey === "name" && sortedInfo.order}
          render={(tags: Array<string>, dataset: APIMaybeUnimportedDataset) => (
            <div>
              {tags.map(tag => (
                <Tag
                  key={tag}
                  color={stringToColor(tag)}
                  onClick={_.partial(this.addTagToSearch, tag)}
                  onClose={_.partial(this.editTagFromDataset, dataset, false, tag)}
                  closable
                >
                  {tag}
                </Tag>
              ))}
              <EditableTextIcon
                icon={<PlusOutlined />}
                onChange={_.partial(this.editTagFromDataset, dataset, true)}
              />
            </div>
          )}
        />
        <Column
          title="Voxel Size & Extent"
          dataIndex="scale"
          key="scale"
          width={230}
          render={(__, dataset: APIMaybeUnimportedDataset) =>
            `${
              dataset.isActive ? formatScale(dataset.dataSource.scale) : ""
            }  ${getDatasetExtentAsString(dataset)}`
          }
        />
        <Column
          width={180}
          title="Creation Date"
          dataIndex="created"
          key="created"
          sorter={Utils.compareBy(typeHint, dataset => dataset.created)}
          sortOrder={sortedInfo.columnKey === "created" && sortedInfo.order}
          render={created => <FormattedDate timestamp={created} />}
        />

        <Column
          title="Allowed Teams"
          dataIndex="allowedTeams"
          key="allowedTeams"
          width={230}
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
          width={130}
          sorter={(a, b) => a.isActive - b.isActive}
          sortOrder={sortedInfo.columnKey === "isActive" && sortedInfo.order}
          render={(isActive: boolean) =>
            isActive ? (
              <CheckCircleOutlined style={{ fontSize: 20 }} />
            ) : (
              <CloseCircleOutlined style={{ fontSize: 20 }} />
            )
          }
        />
        <Column
          title="Public"
          dataIndex="isPublic"
          key="isPublic"
          width={130}
          sorter={(a, b) => a.isPublic - b.isPublic}
          sortOrder={sortedInfo.columnKey === "isPublic" && sortedInfo.order}
          render={(isPublic: boolean) =>
            isPublic ? (
              <CheckCircleOutlined style={{ fontSize: 20 }} />
            ) : (
              <CloseCircleOutlined style={{ fontSize: 20 }} />
            )
          }
        />
        <Column
          title="Data Layers"
          key="dataLayers"
          dataIndex="dataSource.dataLayers"
          render={(__, dataset: APIMaybeUnimportedDataset) => (
            <div style={{ maxWidth: 300 }}>
              {(dataset.isActive ? dataset.dataSource.dataLayers : []).map(layer => (
                <Tag key={layer.name}>
                  {layer.category} - {layer.elementClass}
                </Tag>
              ))}
            </div>
          )}
        />

        <Column
          width={200}
          title="Actions"
          key="actions"
          fixed="right"
          render={(__, dataset: APIMaybeUnimportedDataset) => (
            <DatasetActionView dataset={dataset} updateDataset={this.updateSingleDataset} />
          )}
        />
      </FixedExpandableTable>
    );
  }
}

export default DatasetTable;
