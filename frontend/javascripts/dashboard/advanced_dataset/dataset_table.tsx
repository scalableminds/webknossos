import { FolderOpenOutlined, PlusOutlined, WarningOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Dropdown, MenuProps, Table, Tag, Tooltip } from "antd";
import type { FilterValue, SorterResult, TablePaginationConfig } from "antd/lib/table/interface";
import * as React from "react";
import _ from "lodash";
import { diceCoefficient as dice } from "dice-coefficient";
import type { OxalisState } from "oxalis/store";
import type {
  APIDatasetCompact,
  APIDatasetId,
  APIMaybeUnimportedDataset,
} from "types/api_flow_types";
import { type DatasetFilteringMode } from "dashboard/dataset_view";
import { stringToColor } from "libs/format_utils";
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
import { type DatasetCollectionContextValue } from "dashboard/dataset/dataset_collection_context";
import { Unicode } from "oxalis/constants";
import { DatasetUpdater } from "admin/admin_rest_api";

const { ThinSpace } = Unicode;
const { Column } = Table;
const typeHint: APIDatasetCompact[] = [];
const useLruRank = true;

type Props = {
  datasets: Array<APIDatasetCompact>;
  searchQuery: string;
  searchTags: Array<string>;
  isUserAdmin: boolean;
  isUserDatasetManager: boolean;
  datasetFilteringMode: DatasetFilteringMode;
  reloadDataset: (arg0: APIDatasetId) => Promise<void>;
  updateDataset: (id: APIDatasetId, updater: DatasetUpdater) => void;
  addTagToSearch: (tag: string) => void;
  onSelectDataset: (dataset: APIDatasetCompact | null, multiSelect?: boolean) => void;
  selectedDatasets: APIDatasetCompact[];
  context: DatasetCollectionContextValue;
};
type State = {
  prevSearchQuery: string;
  sortedInfo: SorterResult<string>;
  contextMenuPosition: [number, number] | null | undefined;
  datasetsForContextMenu: APIDatasetCompact[];
};

type ContextMenuProps = {
  contextMenuPosition: [number, number] | null | undefined;
  hideContextMenu: () => void;
  datasets: APIDatasetCompact[];
  reloadDataset: Props["reloadDataset"];
};

function ContextMenuInner(propsWithInputRef: ContextMenuProps) {
  const inputRef = React.useContext(ContextMenuContext);
  const { datasets, reloadDataset, contextMenuPosition, hideContextMenu } = propsWithInputRef;
  let menu: MenuProps = { items: [] };

  if (contextMenuPosition != null) {
    // getDatasetActionContextMenu should not be turned into <DatasetActionMenu />
    // as this breaks antd's styling of the menu within the dropdown.
    menu = getDatasetActionContextMenu({
      hideContextMenu,
      datasets,
      reloadDataset,
    });
  }

  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <React.Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
      <Dropdown
        menu={menu}
        overlayClassName="dropdown-overlay-container-for-context-menu"
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
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
    datasetsForContextMenu: [],
  };
  // currentPageData is only used for range selection (and not during
  // rendering). That's why it's not included in this.state (also it
  // would lead to infinite loops, too).
  currentPageData: APIDatasetCompact[] = [];

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
  ) => {
    this.setState({
      // @ts-ignore
      sortedInfo: sorter,
    });
  };

  reloadSingleDataset = (datasetId: APIDatasetId): Promise<void> =>
    this.props.reloadDataset(datasetId);

  getFilteredDatasets() {
    const filterByMode = (datasets: APIDatasetCompact[]) => {
      const { datasetFilteringMode } = this.props;

      if (datasetFilteringMode === "onlyShowReported") {
        return datasets.filter((el) => !el.isUnreported);
      } else if (datasetFilteringMode === "onlyShowUnreported") {
        return datasets.filter((el) => el.isUnreported);
      } else {
        return datasets;
      }
    };

    const filteredByTags = (datasets: APIDatasetCompact[]) =>
      datasets.filter((dataset) => {
        const notIncludedTags = _.difference(this.props.searchTags, dataset.tags);

        return notIncludedTags.length === 0;
      });

    const filterByHasLayers = (datasets: APIDatasetCompact[]) =>
      this.props.isUserAdmin || this.props.isUserDatasetManager
        ? datasets
        : datasets.filter((dataset) => dataset.isActive);

    return filteredByTags(filterByMode(filterByHasLayers(this.props.datasets)));
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
        {"queries" in this.props.context ? <p>This folder is empty.</p> : <p>No Datasets found.</p>}

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
    const datasetToRankMap: Map<APIDatasetCompact, number> = new Map(
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

    return (
      <DndProvider backend={HTML5Backend}>
        <ContextMenuContainer
          hideContextMenu={() => {
            this.setState({ contextMenuPosition: null });
          }}
          datasets={this.state.datasetsForContextMenu}
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
          summary={(currentPageData) => {
            // Workaround to get to the currently rendered entries (since the ordering
            // is managed by antd).
            // Also see https://github.com/ant-design/ant-design/issues/24022.
            this.currentPageData = currentPageData as APIDatasetCompact[];
            return null;
          }}
          onRow={(record: APIDatasetCompact) => ({
            onDragStart: () => {
              if (!this.props.selectedDatasets.includes(record)) {
                this.props.onSelectDataset(record);
              }
            },
            onClick: (event) => {
              // @ts-expect-error
              if (event.target?.tagName !== "TD") {
                // Don't (de)select when another element within the row was clicked
                // (e.g., a link). Otherwise, clicking such elements would cause two actions
                // (e.g., the link action and a (de)selection).
                return;
              }

              if (!event.shiftKey || this.props.selectedDatasets.length === 0) {
                this.props.onSelectDataset(record, event.ctrlKey || event.metaKey);
              } else {
                // Shift was pressed and there's already another selected dataset that was not
                // clicked just now.
                // We are using the current page data as there is no way to get the currently
                // rendered datasets otherwise. Also see
                // https://github.com/ant-design/ant-design/issues/24022.
                const renderedDatasets = this.currentPageData;

                const clickedDatasetIdx = renderedDatasets.indexOf(record);
                const selectedIndices = this.props.selectedDatasets.map((selectedDS) =>
                  renderedDatasets.indexOf(selectedDS),
                );
                const closestSelectedDatasetIdx = _.minBy(selectedIndices, (idx) =>
                  Math.abs(idx - clickedDatasetIdx),
                );

                if (clickedDatasetIdx == null || closestSelectedDatasetIdx == null) {
                  return;
                }

                const [start, end] = [closestSelectedDatasetIdx, clickedDatasetIdx].sort(
                  (a, b) => a - b,
                );

                for (let idx = start; idx <= end; idx++) {
                  // closestSelectedDatasetIdx is already selected (don't deselect it).
                  if (idx !== closestSelectedDatasetIdx) {
                    this.props.onSelectDataset(renderedDatasets[idx], true);
                  }
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
              if (this.props.selectedDatasets.includes(record)) {
                this.setState({
                  datasetsForContextMenu: this.props.selectedDatasets,
                });
              } else {
                // If dataset is clicked which is not selected, ignore the selected
                // datasets.
                this.setState({
                  datasetsForContextMenu: [record],
                });
              }
            },
            onDoubleClick: () => {
              window.location.href = `/datasets/${record.owningOrganization}/${record.name}/view`;
            },
          })}
          rowSelection={{
            selectedRowKeys: this.props.selectedDatasets.map((ds) => ds.name),
            onSelectNone: () => this.props.onSelectDataset(null),
          }}
        >
          <Column
            title="Name"
            dataIndex="name"
            key="name"
            width={280}
            sorter={Utils.localeCompareBy(typeHint, (dataset) => dataset.name)}
            sortOrder={sortedInfo.columnKey === "name" ? sortedInfo.order : undefined}
            render={(_name: string, dataset: APIDatasetCompact) => (
              <>
                <Link
                  to={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
                  title="View Dataset"
                  className="incognito-link"
                >
                  {dataset.name}
                </Link>
                <br />

                {this.props.context.globalSearchQuery != null ? (
                  <BreadcrumbsTag parts={this.props.context.getBreadcrumbs(dataset)} />
                ) : null}
              </>
            )}
          />
          <Column
            title="Tags"
            dataIndex="tags"
            key="tags"
            sortOrder={sortedInfo.columnKey === "name" ? sortedInfo.order : undefined}
            render={(_tags: Array<string>, dataset: APIDatasetCompact) =>
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
            width={200}
            title="Actions"
            key="actions"
            fixed="right"
            render={(__, dataset: APIDatasetCompact) => (
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
  dataset: APIDatasetCompact;
  onClickTag?: (t: string) => void;
  updateDataset: (id: APIDatasetId, updater: DatasetUpdater) => void;
}) {
  const editTagFromDataset = (
    shouldAddTag: boolean,
    tag: string,
    event: React.SyntheticEvent,
  ): void => {
    event.stopPropagation(); // prevent the onClick event

    if (!dataset.isActive) {
      console.error(
        `Tags can only be modified for active datasets. ${dataset.name} is not active.`,
      );
      return;
    }
    let updater = {};
    if (shouldAddTag) {
      if (!dataset.tags.includes(tag)) {
        updater = {
          tags: [...dataset.tags, tag],
        };
      }
    } else {
      const newTags = _.without(dataset.tags, tag);
      updater = {
        tags: newTags,
      };
    }

    trackAction("Edit dataset tag");
    updateDataset(dataset, updater);
  };

  return (
    <div className="tags-container">
      {dataset.tags.map((tag) => (
        <CategorizationLabel
          tag={tag}
          key={tag}
          kind="datasets"
          onClick={_.partial(onClickTag || _.noop, tag)}
          onClose={_.partial(editTagFromDataset, false, tag)}
          closable={dataset.isEditable}
        />
      ))}
      {dataset.isEditable ? (
        <EditableTextIcon icon={<PlusOutlined />} onChange={_.partial(editTagFromDataset, true)} />
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
    <Tooltip title={`This dataset is located in ${formatPath(allParts)}.`}>
      <Tag>
        <FolderOpenOutlined />
        {formatPath(parts)}
      </Tag>
    </Tooltip>
  );
}

export default DatasetTable;
