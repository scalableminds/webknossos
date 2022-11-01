import { PlusOutlined, WarningOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Table, Tag, Tooltip } from "antd";
import type {
  FilterValue,
  SorterResult,
  TableCurrentDataSource,
  TablePaginationConfig,
} from "antd/lib/table/interface";
import * as React from "react";
import _ from "lodash";
import { diceCoefficient as dice } from "dice-coefficient";
import update from "immutability-helper";
import type {
  APITeam,
  APIMaybeUnimportedDataset,
  APIDatasetId,
  APIDataset,
} from "types/api_flow_types";
import type { DatasetFilteringMode } from "dashboard/dataset_view";
import { getDatasetExtentAsString } from "oxalis/model/accessors/dataset_accessor";
import { stringToColor, formatScale } from "libs/format_utils";
import { trackAction } from "oxalis/model/helpers/analytics";
import CategorizationLabel from "oxalis/view/components/categorization_label";
import DatasetActionView from "dashboard/advanced_dataset/dataset_action_view";
import EditableTextIcon from "oxalis/view/components/editable_text_icon";
import FormattedDate from "components/formatted_date";
import * as Utils from "libs/utils";
import FixedExpandableTable from "components/fixed_expandable_table";

const { Column } = Table;
const typeHint: APIMaybeUnimportedDataset[] = [];
const useLruRank = true;

// antd does not support Symbols as filter values
// which is why this is converted to a string.
const PUBLIC_SYMBOL = Symbol("@public").toString();

type Props = {
  datasets: Array<APIMaybeUnimportedDataset>;
  searchQuery: string;
  searchTags: Array<string>;
  isUserAdmin: boolean;
  isUserDatasetManager: boolean;
  datasetFilteringMode: DatasetFilteringMode;
  reloadDataset: (arg0: APIDatasetId, arg1: Array<APIMaybeUnimportedDataset>) => Promise<void>;
  updateDataset: (arg0: APIDataset) => Promise<void>;
  addTagToSearch: (tag: string) => void;
  onSelectDataset?: (dataset: APIDataset | null) => void;
  selectedDataset?: APIDataset | null | undefined;
};
type State = {
  prevSearchQuery: string;
  sortedInfo: SorterResult<string>;
};

class DatasetTable extends React.PureComponent<Props, State> {
  state: State = {
    sortedInfo: {
      columnKey: useLruRank ? "" : "created",
      order: "descend",
    },
    prevSearchQuery: "",
  };

  static getDerivedStateFromProps(nextProps: Props, prevState: State): Partial<State> {
    const maybeSortedInfo: SorterResult<string> | {} = // Clear the sorting exactly when the search box is initially filled
      // (searchQuery changes from empty string to non-empty string)
      nextProps.searchQuery !== "" && prevState.prevSearchQuery === ""
        ? {
            sortedInfo: {
              columnKey: "",
              order: "ascend",
            },
          }
        : {};
    return {
      prevSearchQuery: nextProps.searchQuery,
      ...maybeSortedInfo,
    };
  }

  handleChange = <RecordType extends object = any>(
    _pagination: TablePaginationConfig,
    _filters: Record<string, FilterValue | null>,
    sorter: SorterResult<RecordType> | SorterResult<RecordType>[],
    _extra: TableCurrentDataSource<RecordType>,
  ) => {
    this.setState({
      // @ts-ignore
      sortedInfo: sorter,
    });
  };

  reloadSingleDataset = (datasetId: APIDatasetId): Promise<void> =>
    this.props.reloadDataset(datasetId, this.props.datasets);

  getFilteredDatasets() {
    const filterByMode = (datasets: APIMaybeUnimportedDataset[]) => {
      const { datasetFilteringMode } = this.props;

      if (datasetFilteringMode === "onlyShowReported") {
        return datasets.filter((el) => !el.isUnreported);
      } else if (datasetFilteringMode === "onlyShowUnreported") {
        return datasets.filter((el) => el.isUnreported);
      } else {
        return datasets;
      }
    };

    const filteredByTags = (datasets: APIMaybeUnimportedDataset[]) =>
      datasets.filter((dataset) => {
        const notIncludedTags = _.difference(this.props.searchTags, dataset.tags);

        return notIncludedTags.length === 0;
      });

    const filterByQuery = (datasets: APIMaybeUnimportedDataset[]) =>
      Utils.filterWithSearchQueryAND<APIMaybeUnimportedDataset, "name" | "description" | "tags">(
        datasets,
        ["name", "description", "tags"],
        this.props.searchQuery,
      );

    const filterByHasLayers = (datasets: APIMaybeUnimportedDataset[]) =>
      this.props.isUserAdmin || this.props.isUserDatasetManager
        ? datasets
        : datasets.filter(
            (dataset) => dataset.isActive && dataset.dataSource.dataLayers.length > 0,
          );

    return filterByQuery(filteredByTags(filterByMode(filterByHasLayers(this.props.datasets))));
  }

  editTagFromDataset = (
    dataset: APIMaybeUnimportedDataset,
    shouldAddTag: boolean,
    tag: string,
    event: React.SyntheticEvent,
  ): void => {
    event.stopPropagation(); // prevent the onClick event

    if (!dataset.isActive) {
      console.error(`Tags can only be added to active datasets. ${dataset.name} is not active.`);
      return;
    }

    let updatedDataset = dataset;

    if (shouldAddTag) {
      if (!dataset.tags.includes(tag)) {
        updatedDataset = update(dataset, {
          tags: {
            $push: [tag],
          },
        });
      }
    } else {
      const newTags = _.without(dataset.tags, tag);

      updatedDataset = update(dataset, {
        tags: {
          $set: newTags,
        },
      });
    }

    trackAction("Edit dataset tag");
    this.props.updateDataset(updatedDataset);
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
    const filteredDataSource = this.getFilteredDatasets();
    const { sortedInfo } = this.state;
    const dataSourceSortedByRank = useLruRank
      ? _.sortBy(filteredDataSource, ["lastUsedByUser", "created"]).reverse()
      : filteredDataSource;
    // Create a map from dataset to its rank
    const datasetToRankMap: Map<APIMaybeUnimportedDataset, number> = new Map(
      dataSourceSortedByRank.map((dataset, rank) => [dataset, rank]),
    );
    const sortedDataSource = // Sort using the dice coefficient if the table is not sorted otherwise
      // and if the query is longer then 3 characters to avoid sorting *all* datasets
      this.props.searchQuery.length > 3 && sortedInfo.columnKey == null
        ? _.chain(filteredDataSource)
            .map((dataset) => {
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

    // antd table filter entries for access permissions / teams
    const accessPermissionFilters = _.uniqBy(
      [
        { text: "public", value: PUBLIC_SYMBOL },
        ...sortedDataSource.flatMap((dataset) =>
          dataset.allowedTeams.map((team) => ({ text: team.name, value: team.name })),
        ),
      ],
      "text",
    );

    // antd table filter entries for data layer names
    const dataLayersFilter = _.uniqBy(
      _.compact(
        sortedDataSource.flatMap((dataset) => {
          if ("dataLayers" in dataset.dataSource) {
            return dataset.dataSource.dataLayers.map((layer) => ({
              text: layer.name,
              value: layer.name,
            }));
          }
          return null;
        }),
      ),
      "text",
    );

    return (
      <FixedExpandableTable
        dataSource={sortedDataSource}
        rowKey="name"
        pagination={{
          defaultPageSize: 50,
        }}
        onChange={this.handleChange}
        locale={{
          emptyText: this.renderEmptyText(),
        }}
        onRow={(record, rowIndex) => {
          return {
            onClick: (event) => {
              if (this.props.onSelectDataset) {
                if (this.props.selectedDataset === record) {
                  this.props.onSelectDataset(null);
                } else {
                  this.props.onSelectDataset(record);
                }
              }
            },
            onDoubleClick: (event) => {
              console.log("todo: open dataset");
            },
          };
        }}
        rowSelection={{
          selectedRowKeys: this.props.selectedDataset ? [this.props.selectedDataset.name] : [],
          onSelectNone: () => this.props.onSelectDataset && this.props.onSelectDataset(null),
        }}
      >
        <Column
          title="Name"
          dataIndex="name"
          key="name"
          width={280}
          sorter={Utils.localeCompareBy(typeHint, (dataset) => dataset.name)}
          sortOrder={sortedInfo.columnKey === "name" ? sortedInfo.order : undefined}
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
          sortOrder={sortedInfo.columnKey === "name" ? sortedInfo.order : undefined}
          render={(tags: Array<string>, dataset: APIMaybeUnimportedDataset) =>
            dataset.isActive ? (
              <div style={{ maxWidth: 280 }}>
                {tags.map((tag) => (
                  <CategorizationLabel
                    tag={tag}
                    key={tag}
                    kind="datasets"
                    onClick={_.partial(this.props.addTagToSearch, tag)}
                    /* @ts-ignore */
                    onClose={_.partial(this.editTagFromDataset, dataset, false, tag)}
                    closable
                  />
                ))}
                <EditableTextIcon
                  icon={<PlusOutlined />}
                  onChange={_.partial(this.editTagFromDataset, dataset, true)}
                />
              </div>
            ) : (
              <Tooltip title="No tags available for inactive datasets">
                <WarningOutlined
                  style={{
                    color: "@disabled-color",
                  }}
                />
              </Tooltip>
            )
          }
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
          sorter={Utils.compareBy(typeHint, (dataset) => dataset.created)}
          sortOrder={sortedInfo.columnKey === "created" ? sortedInfo.order : undefined}
          render={(created) => <FormattedDate timestamp={created} />}
        />

        <Column
          title="Access Permissions"
          dataIndex="allowedTeams"
          key="allowedTeams"
          filters={accessPermissionFilters}
          onFilter={(value, dataset) => {
            if (value === PUBLIC_SYMBOL) {
              return dataset.isPublic;
            }
            return dataset.allowedTeams.some((team) => team.name === value);
          }}
          render={(teams: APITeam[], dataset: APIMaybeUnimportedDataset) => {
            return <TeamTags dataset={dataset} />;
          }}
        />
        <Column
          title="Data Layers"
          key="dataLayers"
          dataIndex="dataSource.dataLayers"
          filters={dataLayersFilter}
          onFilter={(value, dataset: APIMaybeUnimportedDataset) =>
            "dataLayers" in dataset.dataSource
              ? dataset.dataSource.dataLayers.some((layer) => layer.name === value)
              : false
          }
          render={(__, dataset: APIMaybeUnimportedDataset) => (
            <div style={{ maxWidth: 250 }}>
              {(dataset.isActive ? dataset.dataSource.dataLayers : []).map((layer) => (
                <Tag
                  key={layer.name}
                  style={{
                    maxWidth: 250,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {layer.name} - {layer.elementClass}
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
            <DatasetActionView dataset={dataset} reloadDataset={this.reloadSingleDataset} />
          )}
        />
      </FixedExpandableTable>
    );
  }
}

export function TeamTags({ dataset }: { dataset: APIMaybeUnimportedDataset }) {
  const teams = dataset.allowedTeams;
  const permittedTeams = [...teams];
  if (dataset.isPublic) {
    permittedTeams.push({ name: "public", id: "", organization: "" });
  }

  return (
    <>
      {permittedTeams.map((team) => (
        <div key={`allowed_teams_${dataset.name}_${team.name}`}>
          <Tag
            style={{
              maxWidth: 200,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
            color={stringToColor(team.name)}
          >
            {team.name}
          </Tag>
        </div>
      ))}
    </>
  );
}

export default DatasetTable;
