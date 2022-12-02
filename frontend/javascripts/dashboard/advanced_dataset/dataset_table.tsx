import { PlusOutlined, WarningOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Dropdown, Table, Tag, Tooltip } from "antd";
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
import type { OxalisState } from "oxalis/store";
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
import DatasetActionView, {
  getDatasetActionContextMenu,
} from "dashboard/advanced_dataset/dataset_action_view";
import EditableTextIcon from "oxalis/view/components/editable_text_icon";
import FormattedDate from "components/formatted_date";
import * as Utils from "libs/utils";
import FixedExpandableTable from "components/fixed_expandable_table";
import { DndProvider, DragPreviewImage, useDrag } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { ContextMenuContext, GenericContextMenuContainer } from "oxalis/view/context_menu";
import Shortcut from "libs/shortcut_component";
import { MINIMUM_SEARCH_QUERY_LENGTH } from "dashboard/dataset/queries";
import { useSelector } from "react-redux";
import { DatasetCacheContextValue } from "dashboard/dataset/dataset_cache_provider";
import { DatasetCollectionContextValue } from "dashboard/dataset/dataset_collection_context";
import { Unicode } from "oxalis/constants";

const { ThinSpace } = Unicode;
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
  reloadDataset: (arg0: APIDatasetId, arg1?: Array<APIMaybeUnimportedDataset>) => Promise<void>;
  updateDataset: (arg0: APIDataset) => Promise<void>;
  addTagToSearch: (tag: string) => void;
  onSelectDataset?: (dataset: APIMaybeUnimportedDataset | null) => void;
  selectedDataset?: APIMaybeUnimportedDataset | null | undefined;
  hideDetailsColumns?: boolean;
  context: DatasetCacheContextValue | DatasetCollectionContextValue;
};
type State = {
  prevSearchQuery: string;
  sortedInfo: SorterResult<string>;
  contextMenuPosition: [number, number] | null | undefined;
  datasetForContextMenu: APIMaybeUnimportedDataset | null;
};

type ContextMenuProps = {
  contextMenuPosition: [number, number] | null | undefined;
  hideContextMenu: () => void;
  dataset: APIMaybeUnimportedDataset | null;
  reloadDataset: Props["reloadDataset"];
};

function ContextMenuInner(propsWithInputRef: ContextMenuProps) {
  const inputRef = React.useContext(ContextMenuContext);
  const { dataset, reloadDataset, contextMenuPosition, hideContextMenu } = propsWithInputRef;
  let overlay = <div />;

  if (contextMenuPosition != null && dataset != null) {
    // getDatasetActionContextMenu should not be turned into <DatasetActionMenu />
    // as this breaks antd's styling of the menu within the dropdown.
    overlay = getDatasetActionContextMenu({
      hideContextMenu,
      dataset,
      reloadDataset,
    });
  }

  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <React.Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
      <Dropdown
        overlay={overlay}
        overlayClassName="dropdown-overlay-container-for-context-menu"
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        // @ts-ignore
        destroyPopupOnHide
      >
        <div />
      </Dropdown>
    </React.Fragment>
  );
}

function ContextMenuContainer(props: ContextMenuProps) {
  return (
    /* Sticky positioning doesn't work for this container for some reason.
     * The y position is always off by a certain amount.
     * Maybe because the container doesn't cover the entire screen?
     * Use absolute positioning for now. This forgoes the "stay-in-container"
     * behavior, but that's not critical for the context menu right now.
     */
    <GenericContextMenuContainer positionAbsolute {...props}>
      <ContextMenuInner {...props} />
    </GenericContextMenuContainer>
  );
}

// Adapted from https://ant.design/components/table/
// (needed adaption to react-dnd 11.1.3). Updating react-dnd
// wasn't possible due to react-sortable-tree.
interface DraggableDatasetRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  index: number;
}
export const DraggableDatasetType = "DraggableDatasetRow";

class DragPreviewProvider {
  static singleton: DragPreviewProvider | null;
  lightIcon: string | null;
  darkIcon: string | null;

  constructor() {
    // We fine-tune the drag image of a row because some browsers don't make
    // the row transparent enough. Since the table row is quite wide, it often
    // hides important UI elements (such as the directory sidebar).
    // Unfortunately, the icons have to be converted to a DataURL to work with
    // DragPreviewImage from react-dnd. This conversion is handled by this class
    // here.

    // The icons are loaded asynchronously as soon as DragPreviewProvider
    // is instantiated. As long as the files were not loaded, an empty
    // string will be used for the preview which the browser will simply ignore
    // and do its default drag behavior (i.e., showing a drag preview of the entire
    // row).
    this.lightIcon = null;
    this.darkIcon = null;
    this.convertImageURLtoDataURL("/assets/images/file-light.png").then((dataURL) => {
      this.lightIcon = dataURL;
    });
    this.convertImageURLtoDataURL("/assets/images/file-dark.png").then((dataURL) => {
      this.darkIcon = dataURL;
    });
  }

  convertImageURLtoDataURL(src: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "Anonymous";
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) {
          return reject("Could not construct context");
        }
        canvas.height = image.naturalHeight;
        canvas.width = image.naturalWidth;
        context.drawImage(image, 0, 0);
        const dataURL = canvas.toDataURL("image/png");
        resolve(dataURL);
      };
      image.src = src;
    });
  }

  getIcon(theme: "dark" | "light") {
    if (theme === "dark") {
      return this.darkIcon || "";
    } else {
      return this.lightIcon || "";
    }
  }

  static getProvider() {
    if (!DragPreviewProvider.singleton) {
      DragPreviewProvider.singleton = new DragPreviewProvider();
    }
    return DragPreviewProvider.singleton;
  }
}

const DraggableDatasetRow = ({
  index,
  className,
  style,
  children,
  ...restProps
}: DraggableDatasetRowProps) => {
  const ref = React.useRef<HTMLTableRowElement>(null);
  const theme = useSelector((state: OxalisState) => state.uiInformation.theme);
  // @ts-ignore
  const datasetName = restProps["data-row-key"];
  const [, drag, preview] = useDrag({
    item: { type: DraggableDatasetType, index, datasetName },
  });
  drag(ref);

  const fileIcon = DragPreviewProvider.getProvider().getIcon(theme);

  return (
    <tr ref={ref} className={className} style={{ cursor: "move", ...style }} {...restProps}>
      <DragPreviewImage connect={preview} src={fileIcon} />
      {children}
    </tr>
  );
};

const components = {
  body: {
    row: DraggableDatasetRow,
  },
};

class DatasetTable extends React.PureComponent<Props, State> {
  state: State = {
    sortedInfo: {
      columnKey: useLruRank ? "" : "created",
      order: "descend",
    },
    prevSearchQuery: "",
    contextMenuPosition: null,
    datasetForContextMenu: null,
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

  showContextMenuAt = (xPos: number, yPos: number) => {
    // On Windows the right click to open the context menu is also triggered for the overlay
    // of the context menu. This causes the context menu to instantly close after opening.
    // Therefore delay the state update to delay that the context menu is rendered.
    // Thus the context overlay does not get the right click as an event and therefore does not close.
    setTimeout(
      () =>
        this.setState({
          contextMenuPosition: [xPos, yPos],
        }),
      0,
    );
  };

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
    const sortedDataSource =
      // Sort using the dice coefficient if the table is not sorted by another key
      // and if the query is at least 3 characters long to avoid sorting *all* datasets
      this.props.searchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH && sortedInfo.columnKey == null
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
      <DndProvider backend={HTML5Backend}>
        <ContextMenuContainer
          hideContextMenu={() => {
            this.setState({ contextMenuPosition: null });
          }}
          dataset={this.state.datasetForContextMenu}
          reloadDataset={this.props.reloadDataset}
          contextMenuPosition={this.state.contextMenuPosition}
        />
        <FixedExpandableTable
          dataSource={sortedDataSource}
          rowKey="name"
          components={components}
          pagination={{
            defaultPageSize: 50,
          }}
          className="hide-checkbox-selection"
          onChange={this.handleChange}
          locale={{
            emptyText: this.renderEmptyText(),
          }}
          onRow={(record: APIMaybeUnimportedDataset) => ({
            onClick: (event) => {
              // @ts-expect-error
              if (event.target?.tagName !== "TD") {
                // Don't (de)select when another element within the row was clicked
                // (e.g., a link). Otherwise, clicking such elements would cause two actions
                // (e.g., the link action and a (de)selection).
                return;
              }
              if (this.props.onSelectDataset) {
                if (this.props.selectedDataset === record) {
                  this.props.onSelectDataset(null);
                } else {
                  this.props.onSelectDataset(record);
                }
              }
            },
            onContextMenu: (event) => {
              event.preventDefault();

              // Find the overlay div whose parent acts as a reference for positioning the context menu.
              // Since the dashboard tabs don't destroy their contents after switching the tabs,
              // there might be several overlays. We will use the one with a non-zero width since
              // this should be the relevant one.
              const overlayDivs = document.getElementsByClassName("node-context-menu-overlay");
              const referenceDiv = Array.from(overlayDivs)
                .map((p) => p.parentElement)
                .find((potentialParent) => {
                  if (potentialParent == null) {
                    return false;
                  }
                  const bounds = potentialParent.getBoundingClientRect();
                  return bounds.width > 0;
                });

              if (referenceDiv == null) {
                return;
              }
              const bounds = referenceDiv.getBoundingClientRect();
              const x = event.clientX - bounds.left;
              const y = event.clientY - bounds.top;

              this.showContextMenuAt(x, y);
              this.setState({ datasetForContextMenu: record });
            },
            onDoubleClick: () => {
              window.location.href = `/datasets/${record.owningOrganization}/${record.name}/view`;
            },
          })}
          rowSelection={{
            selectedRowKeys: this.props.selectedDataset ? [this.props.selectedDataset.name] : [],
            onSelectNone: () => this.props.onSelectDataset?.(null),
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
              <>
                <Link
                  to={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
                  title="View Dataset"
                  className="incognito-link"
                >
                  {dataset.name}
                </Link>
                <br />

                {"getBreadcrumbs" in this.props.context ? (
                  <BreadcrumbsTag parts={this.props.context.getBreadcrumbs(dataset)} />
                ) : (
                  <Tag color={stringToColor(dataset.dataStore.name)}>{dataset.dataStore.name}</Tag>
                )}
              </>
            )}
          />
          <Column
            title="Tags"
            dataIndex="tags"
            key="tags"
            sortOrder={sortedInfo.columnKey === "name" ? sortedInfo.order : undefined}
            render={(tags: Array<string>, dataset: APIMaybeUnimportedDataset) =>
              dataset.isActive ? (
                <DatasetTags
                  dataset={dataset}
                  onClickTag={this.props.addTagToSearch}
                  updateDataset={this.props.updateDataset}
                />
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
          {!this.props.hideDetailsColumns ? (
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
          ) : null}
          <Column
            width={180}
            title="Creation Date"
            dataIndex="created"
            key="created"
            sorter={Utils.compareBy(typeHint, (dataset) => dataset.created)}
            sortOrder={sortedInfo.columnKey === "created" ? sortedInfo.order : undefined}
            render={(created) => <FormattedDate timestamp={created} />}
          />
          {!this.props.hideDetailsColumns ? (
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
              render={(teams: APITeam[], dataset: APIMaybeUnimportedDataset) => (
                <TeamTags dataset={dataset} />
              )}
            />
          ) : null}
          {!this.props.hideDetailsColumns ? (
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
                <DatasetLayerTags dataset={dataset} />
              )}
            />
          ) : null}

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
      </DndProvider>
    );
  }
}

export function DatasetTags({
  dataset,
  onClickTag,
  updateDataset,
}: {
  dataset: APIDataset;
  onClickTag?: (t: string) => void;
  updateDataset: (d: APIDataset) => void;
}) {
  const editTagFromDataset = (
    updatedDataset: APIMaybeUnimportedDataset,
    shouldAddTag: boolean,
    tag: string,
    event: React.MouseEvent,
  ): void => {
    event.stopPropagation(); // prevent the onClick event

    if (!updatedDataset.isActive) {
      console.error(
        `Tags can only be modified for active datasets. ${updatedDataset.name} is not active.`,
      );
      return;
    }

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
    updateDataset(updatedDataset);
  };

  return (
    <div style={{ maxWidth: 280 }}>
      {dataset.tags.map((tag) => (
        <CategorizationLabel
          tag={tag}
          key={tag}
          kind="datasets"
          onClick={_.partial(onClickTag || _.noop, tag)}
          onClose={_.partial(editTagFromDataset, dataset, false, tag)}
          closable={dataset.isEditable}
        />
      ))}
      {dataset.isEditable ? (
        <EditableTextIcon
          icon={<PlusOutlined />}
          onChange={_.partial(editTagFromDataset, dataset, true)}
        />
      ) : null}
    </div>
  );
}

export function DatasetLayerTags({ dataset }: { dataset: APIMaybeUnimportedDataset }) {
  return (
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
  );
}

export function TeamTags({
  dataset,
  emptyValue,
}: {
  dataset: APIMaybeUnimportedDataset;
  emptyValue?: React.ReactNode;
}) {
  const teams = dataset.allowedTeamsCumulative;
  const permittedTeams = [...teams];
  if (dataset.isPublic) {
    permittedTeams.push({ name: "public", id: "", organization: "" });
  }

  if (permittedTeams.length === 0 && emptyValue != null) {
    return <Tag>{emptyValue}</Tag>;
  }

  const allowedTeamsById = _.keyBy(dataset.allowedTeams, "id");
  return (
    <>
      {permittedTeams.map((team) => {
        const isCumulative = !allowedTeamsById[team.id];
        return (
          <Tooltip
            title={
              isCumulative
                ? "This team may access this dataset, because of the permissions of the current folder."
                : null
            }
            key={`allowed_teams_${dataset.name}_${team.name}`}
          >
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
              {isCumulative ? "*" : ""}
            </Tag>
          </Tooltip>
        );
      })}
    </>
  );
}

function formatPath(parts: string[]) {
  return parts.join(`${ThinSpace}/${ThinSpace}`);
}

function BreadcrumbsTag({ parts: allParts }: { parts: string[] | null }) {
  if (allParts == null) {
    return null;
  }
  let parts;
  if (allParts.length <= 4) {
    parts = allParts;
  } else {
    parts = [...allParts.slice(0, 2), "...", ...allParts.slice(-2)];
  }

  return (
    <Tooltip title={`This folder is located in ${formatPath(allParts)}.`}>
      <Tag>{formatPath(parts)}</Tag>
    </Tooltip>
  );
}

export default DatasetTable;
