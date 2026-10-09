import Icon, { NodeIndexOutlined, TeamOutlined } from "@ant-design/icons";
import IconSort from "@images/icons/icon-sort.svg?react";
import { Button, Radio, Space, Table, Tag } from "antd";
import type { ColumnType } from "antd/es/table/interface";
import FormattedDate from "components/formatted_date";
import TextWithDescription from "components/text_with_description";
import {
  FilterChip,
  ListFilterHeader,
  RowMetaLine,
  SearchableRadioFilterChip,
  TagFilterChip,
} from "dashboard/list_filter_header";
import { stringToTagColor } from "libs/colors";
import {
  compareBy,
  filterWithSearchQueryAND,
  localeCompareBy,
  pluralize,
  scrollToTop,
} from "libs/utils";
import compact from "lodash-es/compact";
import difference from "lodash-es/difference";
import uniqBy from "lodash-es/uniqBy";
import type React from "react";
import { useState } from "react";
import type { APIAnnotationInfo, APITeam, APIUser, APIUserCompact } from "types/api_types";
import type { Comparator } from "types/type_utils";
import {
  getStatsOfAnnotationInfo,
  isAnnotationEditableByNonOwners,
} from "viewer/model/accessors/annotation_accessor";
import { AnnotationStats } from "viewer/view/right_border_tabs/info_tab/annotation_stats_section";
import { AnnotationStatusLabels } from "./annotation_status_labels";
import { AnnotationTags } from "./annotation_tags";

type AnnotationSortOption = "modifiedDesc" | "newest" | "oldest" | "owner" | "name";
const ANNOTATION_SORT_OPTIONS: Array<{ key: AnnotationSortOption; label: string }> = [
  { key: "modifiedDesc", label: "Last Modified" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "owner", label: "Owner" },
  { key: "name", label: "Name" },
];

// Sorts ascending by the selector's string value, except entries with an empty
// (trimmed) selector value always sort last, regardless of alphabetical order.
function compareWithEmptyLast<T>(selector: (item: T) => string): Comparator<T> {
  const naturalCompare = localeCompareBy<T>(selector);
  return (a: T, b: T) => {
    const aIsEmpty = selector(a).trim() === "";
    const bIsEmpty = selector(b).trim() === "";
    if (aIsEmpty && bIsEmpty) return 0;
    if (aIsEmpty) return 1;
    if (bIsEmpty) return -1;
    return naturalCompare(a, b);
  };
}

function getSortComparator(sortOption: AnnotationSortOption): Comparator<APIAnnotationInfo> {
  switch (sortOption) {
    case "name":
      return compareWithEmptyLast<APIAnnotationInfo>((annotation) => annotation.name);
    case "owner":
      return compareWithEmptyLast<APIAnnotationInfo>((annotation) =>
        annotation.owner ? formatUserName(annotation.owner) : "",
      );
    case "newest":
      return compareBy<APIAnnotationInfo>((annotation) => annotation.created, false);
    case "oldest":
      return compareBy<APIAnnotationInfo>((annotation) => annotation.created, true);
    default:
      // "modifiedDesc"
      return compareBy<APIAnnotationInfo>((annotation) => annotation.modified, false);
  }
}

function formatUserName(user: APIUserCompact) {
  return `${user.firstName} ${user.lastName}`;
}

export function isAnnotationEditable(annotation: APIAnnotationInfo, activeUser: APIUser): boolean {
  return annotation.owner?.id === activeUser.id || isAnnotationEditableByNonOwners(annotation);
}

export function mayArchiveAnnotation(annotation: APIAnnotationInfo, activeUser: APIUser): boolean {
  return (
    annotation.typ === "Explorational" &&
    annotation.state === "Active" &&
    isAnnotationEditable(annotation, activeUser) &&
    !annotation.isLockedByOwner
  );
}

export function mayLockAnnotation(annotation: APIAnnotationInfo, activeUser: APIUser): boolean {
  return (
    annotation.typ === "Explorational" &&
    annotation.state === "Active" &&
    annotation.owner?.id === activeUser.id
  );
}

type Props = {
  annotations: Array<APIAnnotationInfo>;
  activeUser: APIUser;
  isAdminView: boolean;
  isLoading: boolean;
  // Whether more annotations exist than were loaded. Shown as "+" after the count.
  hasMoreAnnotations: boolean;
  searchQuery: string;
  tags: Array<string>;
  onTagsChange: (tags: Array<string>) => void;
  showArchived: boolean;
  onShowArchivedChange: (showArchived: boolean) => void;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (annotationId: string | null) => void;
  renderActions: (annotation: APIAnnotationInfo) => React.ReactNode;
  // Shown instead of the list if there are no annotations and no search or filter is active.
  emptyPlaceholder: React.ReactNode;
  // Called when the user clears the search and filters that are controlled from outside.
  onClearFilters: () => void;
  // Called with the annotations shown on the current page (after search, filters and sorting).
  onCurrentPageDataChange?: (annotations: Readonly<APIAnnotationInfo[]>) => void;
  // Alignment annotations are marked with their layer pair, e.g. "Alignment: color_2 → color_1".
  // Lists that only contain alignment annotations can leave out the "Alignment:" prefix.
  hideAlignmentPrefix?: boolean;
};

// A list of annotations with a header to filter and sort them, as shown in the dashboard.
export function AnnotationList({
  annotations,
  activeUser,
  isAdminView,
  isLoading,
  hasMoreAnnotations,
  searchQuery,
  tags,
  onTagsChange,
  showArchived,
  onShowArchivedChange,
  selectedAnnotationId,
  onSelectAnnotation,
  renderActions,
  emptyPlaceholder,
  onClearFilters,
  onCurrentPageDataChange,
  hideAlignmentPrefix = false,
}: Props) {
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<AnnotationSortOption>("modifiedDesc");

  const isOwnedByActiveUser = (owner: APIUserCompact) => !isAdminView && owner.id === activeUser.id;

  const addTagToSearch = (tag: string) => {
    if (!tags.includes(tag)) {
      onTagsChange([...tags, tag]);
    }
  };

  const clearSearchAndFilters = () => {
    setSelectedOwnerId(null);
    setSelectedTeamId(null);
    onClearFilters();
  };

  const searchFilteredAnnotations = filterWithSearchQueryAND(
    annotations,
    ["id", "name", "modified", "tags", "owner"],
    searchQuery,
  ).filter((annotation) => difference(tags, annotation.tags).length === 0);

  const ownerFilters = uniqBy(
    // Prepend the active user's own entry to the front so that it's listed first.
    ([activeUser] as APIUserCompact[]).concat(
      compact(searchFilteredAnnotations.map((annotation) => annotation.owner)),
    ),
    "id",
  );
  const teamFilters = uniqBy(
    searchFilteredAnnotations.flatMap((annotation) => annotation.teams),
    "id",
  );

  const filteredAndSortedAnnotations = searchFilteredAnnotations
    .filter(
      (annotation) =>
        (selectedOwnerId == null || annotation.owner?.id === selectedOwnerId) &&
        (selectedTeamId == null || annotation.teams.some((team) => team.id === selectedTeamId)),
    )
    .sort(getSortComparator(sortOption));

  const renderOwner = (owner: APIUserCompact) => {
    if (isOwnedByActiveUser(owner)) {
      return (
        <span>
          {formatUserName(owner)}{" "}
          <span style={{ color: "var(--ant-color-text-secondary)" }}>(you)</span>
        </span>
      );
    }
    return formatUserName(owner);
  };

  const renderAnnotationRow = (annotation: APIAnnotationInfo) => {
    const { owner } = annotation;
    const stats = getStatsOfAnnotationInfo(annotation);
    const teamTags = annotation.teams.map((team) => (
      <Tag
        key={team.id}
        color={stringToTagColor(team.name)}
        variant="outlined"
        className="dashboard-team-tag"
      >
        {team.name}
      </Tag>
    ));
    const ownerText =
      owner == null ? null : isOwnedByActiveUser(owner) ? "you" : formatUserName(owner);

    return (
      <div>
        <span className="dashboard-annotation-name" style={{ marginInlineEnd: 8 }}>
          <TextWithDescription
            value={annotation.name}
            placeholder="Unnamed annotation"
            description={annotation.description}
            linkTarget={`/annotations/${annotation.id}`}
            linkTitle="Open"
          />
        </span>
        <AnnotationStatusLabels
          isReadOnly={!isAnnotationEditable(annotation, activeUser)}
          isLocked={annotation.isLockedByOwner}
        />
        {annotation.layerAlignment != null ? (
          <Tag icon={<NodeIndexOutlined />} variant="outlined">
            {hideAlignmentPrefix ? null : "Alignment: "}
            {annotation.layerAlignment.movingLayerName} → {annotation.layerAlignment.fixedLayerName}
          </Tag>
        ) : null}
        {/* Tags are edited in the details sidebar, so they are only clickable for filtering here. */}
        <AnnotationTags
          annotation={annotation}
          isEditable={false}
          onClickTag={addTagToSearch}
          onAddTag={() => {}}
          onRemoveTag={() => {}}
          className="dashboard-annotation-tags"
        />
        <RowMetaLine
          items={[
            <span key="created">
              created <FormattedDate timestamp={annotation.created} />
              {ownerText != null ? ` by ${ownerText}` : null}
            </span>,
            teamTags.length > 0 ? (
              <span key="teams" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <TeamOutlined /> shared with teams {teamTags}
              </span>
            ) : null,
            // Checked here as well, so that no dangling separator dot is rendered for an empty stats item.
            Object.keys(stats).length > 0 ? (
              <AnnotationStats key="stats" stats={stats} orientation="horizontal" />
            ) : null,
          ]}
        />
      </div>
    );
  };

  const renderEmptyText = (): React.ReactNode => {
    if (isLoading) {
      return null;
    }
    const isSearchOrFilterActive =
      searchQuery !== "" ||
      tags.length > 0 ||
      selectedOwnerId != null ||
      selectedTeamId != null ||
      showArchived;

    if (!isSearchOrFilterActive) {
      return emptyPlaceholder;
    }

    const activeFilterLabels: string[] = [];
    if (tags.length > 0) activeFilterLabels.push("tags");
    if (selectedOwnerId != null) activeFilterLabels.push("owner");
    if (selectedTeamId != null) activeFilterLabels.push("teams");
    if (showArchived) activeFilterLabels.push("status");

    return (
      <>
        <p>No annotations match your search.</p>
        {activeFilterLabels.length > 0 ? (
          <p>Note that annotations are currently filtered by {activeFilterLabels.join(", ")}.</p>
        ) : null}
        <Button type="link" onClick={clearSearchAndFilters}>
          Clear search and filters
        </Button>
      </>
    );
  };

  const columns: ColumnType<APIAnnotationInfo>[] = [
    {
      dataIndex: "name",
      key: "name",
      className: "dashboard-list-table-borderless-cell",
      render: (_name: string, annotation: APIAnnotationInfo) => renderAnnotationRow(annotation),
    },
    {
      width: 1,
      className: "nowrap",
      key: "action",
      render: (__: any, annotation: APIAnnotationInfo) => renderActions(annotation),
    },
  ];

  const currentSortLabel =
    ANNOTATION_SORT_OPTIONS.find((option) => option.key === sortOption)?.label ?? "Last Modified";

  return (
    <>
      <ListFilterHeader
        summary={`${filteredAndSortedAnnotations.length}${hasMoreAnnotations ? "+" : ""} ${pluralize("Annotation", filteredAndSortedAnnotations.length)}`}
      >
        <TagFilterChip
          selectedTags={tags}
          availableTags={annotations.flatMap((annotation) => annotation.tags)}
          onChange={onTagsChange}
        />
        <SearchableRadioFilterChip
          label="Owner"
          searchPlaceholder="Search owners"
          options={ownerFilters.map((owner) => ({
            key: owner.id,
            label: renderOwner(owner),
            searchText: formatUserName(owner),
          }))}
          selectedKey={selectedOwnerId}
          onChange={setSelectedOwnerId}
        />
        <SearchableRadioFilterChip
          label="Teams"
          searchPlaceholder="Search teams"
          options={teamFilters.map((team: APITeam) => ({
            key: team.id,
            label: team.name,
            searchText: team.name,
          }))}
          selectedKey={selectedTeamId}
          onChange={setSelectedTeamId}
        />
        <FilterChip label="Status" active={showArchived}>
          <Space orientation="vertical" size={4}>
            <Radio checked={!showArchived} onChange={() => onShowArchivedChange(false)}>
              Open
            </Radio>
            <Radio checked={showArchived} onChange={() => onShowArchivedChange(true)}>
              Archived
            </Radio>
          </Space>
        </FilterChip>
        <FilterChip
          label={
            <>
              <Icon component={IconSort} /> Sort: {currentSortLabel}
            </>
          }
        >
          <Space orientation="vertical" size={4}>
            {ANNOTATION_SORT_OPTIONS.map((option) => (
              <Radio
                key={option.key}
                checked={sortOption === option.key}
                onChange={() => setSortOption(option.key)}
              >
                {option.label}
              </Radio>
            ))}
          </Space>
        </FilterChip>
      </ListFilterHeader>
      <Table
        dataSource={filteredAndSortedAnnotations}
        rowKey="id"
        showHeader={false}
        bordered
        loading={isLoading}
        pagination={{
          defaultPageSize: 50,
          onChange: scrollToTop,
        }}
        locale={{
          emptyText: renderEmptyText(),
        }}
        className="large-table dashboard-list-table"
        rowClassName={(annotation: APIAnnotationInfo) =>
          annotation.id === selectedAnnotationId ? "ant-table-row-selected" : ""
        }
        onRow={(annotation: APIAnnotationInfo) => ({
          onClick: (event) => {
            const { tagName } = event.target as HTMLElement;
            // Don't (de)select when another element within the row was clicked (e.g., a link).
            if (tagName !== "TD" && tagName !== "DIV") return;
            onSelectAnnotation(selectedAnnotationId === annotation.id ? null : annotation.id);
          },
        })}
        summary={(currentPageData) => {
          // See this issue for context:
          // https://github.com/ant-design/ant-design/issues/24022#issuecomment-1050070509
          // Currently, there is no other way to easily get the items which are rendered by
          // the table (while respecting the active filters).
          // Using <Table onChange={...} /> is not a solution. See this explanation:
          // https://github.com/ant-design/ant-design/issues/24022#issuecomment-691842572
          onCurrentPageDataChange?.(currentPageData);
          return null;
        }}
        columns={columns}
      />
    </>
  );
}
