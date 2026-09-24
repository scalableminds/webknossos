import { DownOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Dropdown,
  Flex,
  Input,
  type InputRef,
  Radio,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import type React from "react";
import { useRef, useState } from "react";
import { getCategorizationTagColor } from "viewer/view/components/categorization_label";

export function ListFilterHeader({
  summary,
  children,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Flex
      justify="space-between"
      align="center"
      wrap="wrap"
      gap="small"
      className="dashboard-list-filter-bar"
    >
      <Typography.Text type="secondary">{summary}</Typography.Text>
      <Space size="small" wrap>
        {children}
      </Space>
    </Flex>
  );
}

export function FilterChip({
  label,
  active,
  onOpenChange,
  children,
}: {
  label: React.ReactNode;
  active?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Dropdown
      trigger={["click"]}
      onOpenChange={onOpenChange}
      popupRender={() => (
        <div
          style={{
            background: token.colorBgElevated,
            boxShadow: token.boxShadowSecondary,
            borderRadius: token.borderRadiusLG,
            padding: 12,
            minWidth: 200,
            maxHeight: "min(400px, 60vh)",
            overflowY: "auto",
          }}
        >
          {children}
        </div>
      )}
    >
      <Button type={active ? "default" : "text"} icon={<DownOutlined />} iconPlacement="end">
        {label}
      </Button>
    </Dropdown>
  );
}

// Search state for a filter chip's dropdown: cleared and focused whenever the dropdown opens.
function useFilterChipSearch() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<InputRef>(null);
  const lowerCaseQuery = query.trim().toLowerCase();
  return {
    query,
    setQuery,
    inputRef,
    matches: (text: string) => text.toLowerCase().includes(lowerCaseQuery),
    // The popup content stays mounted after the first open, so autoFocus alone wouldn't suffice.
    onOpenChange: (open: boolean) => {
      if (open) {
        setQuery("");
        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      }
    },
  };
}

function FilterChipSearchInput({
  search,
  placeholder,
  onPressEnter,
}: {
  search: ReturnType<typeof useFilterChipSearch>;
  placeholder: string;
  onPressEnter: () => void;
}) {
  return (
    <Input
      ref={search.inputRef}
      size="small"
      allowClear
      placeholder={placeholder}
      prefix={<SearchOutlined />}
      value={search.query}
      onChange={(event) => search.setQuery(event.target.value)}
      onPressEnter={onPressEnter}
    />
  );
}

// Scrolls the list itself, so the search input stays visible.
function FilterChipList({ children }: { children: React.ReactNode }) {
  return (
    <Space
      orientation="vertical"
      size={4}
      style={{ width: "100%", maxHeight: "min(300px, 40vh)", overflowY: "auto" }}
    >
      {children}
    </Space>
  );
}

// Filters by tags (items must have all selected tags). The offered tags accumulate over the
// component's lifetime, so they only grow as new tags appear in the list (e.g., new search results).
export function TagFilterChip({
  selectedTags,
  availableTags,
  onChange,
}: {
  selectedTags: string[];
  availableTags: Iterable<string>;
  onChange: (tags: string[]) => void;
}) {
  const search = useFilterChipSearch();
  const knownTagsRef = useRef(new Set<string>());
  for (const tag of [...availableTags, ...selectedTags]) {
    knownTagsRef.current.add(tag);
  }
  const knownTags = Array.from(knownTagsRef.current).sort((a, b) => a.localeCompare(b));
  const visibleTags = knownTags.filter(search.matches);

  const toggleTag = (tag: string, isChecked: boolean) =>
    onChange(isChecked ? [...selectedTags, tag] : selectedTags.filter((t) => t !== tag));

  return (
    <FilterChip label="Tags" active={selectedTags.length > 0} onOpenChange={search.onOpenChange}>
      {knownTags.length === 0 ? (
        <Typography.Text type="secondary">No tags available</Typography.Text>
      ) : (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <FilterChipSearchInput
            search={search}
            placeholder="Search tags"
            onPressEnter={() => {
              const firstVisibleTag = visibleTags[0];
              if (firstVisibleTag != null) {
                toggleTag(firstVisibleTag, !selectedTags.includes(firstVisibleTag));
              }
            }}
          />
          <FilterChipList>
            {visibleTags.map((tag) => (
              <Checkbox
                key={tag}
                checked={selectedTags.includes(tag)}
                onChange={(event) => toggleTag(tag, event.target.checked)}
              >
                <Tag
                  color={getCategorizationTagColor(tag)}
                  variant="outlined"
                  style={{ marginInlineEnd: 0 }}
                >
                  {tag}
                </Tag>
              </Checkbox>
            ))}
          </FilterChipList>
          {selectedTags.length > 0 ? (
            <Typography.Link onClick={() => onChange([])}>Clear</Typography.Link>
          ) : null}
        </Space>
      )}
    </FilterChip>
  );
}

export type RadioFilterOption = {
  key: string;
  label: React.ReactNode;
  // Plain text the search matches against.
  searchText: string;
};

// Single-choice filter with an "All" option (key null) and a search input. Enter selects the
// first visible option; "All" is only visible (and thus picked by Enter) while the search is empty.
export function SearchableRadioFilterChip({
  label,
  searchPlaceholder,
  options,
  selectedKey,
  onChange,
}: {
  label: React.ReactNode;
  searchPlaceholder: string;
  options: RadioFilterOption[];
  selectedKey: string | null;
  onChange: (key: string | null) => void;
}) {
  const search = useFilterChipSearch();
  const visibleOptions = options.filter((option) => search.matches(option.searchText));
  const isAllVisible = search.query.trim() === "";

  return (
    <FilterChip label={label} active={selectedKey != null} onOpenChange={search.onOpenChange}>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <FilterChipSearchInput
          search={search}
          placeholder={searchPlaceholder}
          onPressEnter={() => {
            if (isAllVisible) {
              onChange(null);
            } else if (visibleOptions.length > 0) {
              onChange(visibleOptions[0].key);
            }
          }}
        />
        <FilterChipList>
          {isAllVisible ? (
            <Radio checked={selectedKey == null} onChange={() => onChange(null)}>
              All
            </Radio>
          ) : null}
          {visibleOptions.map((option) => (
            <Radio
              key={option.key}
              checked={selectedKey === option.key}
              onChange={() => onChange(option.key)}
            >
              {option.label}
            </Radio>
          ))}
        </FilterChipList>
      </Space>
    </FilterChip>
  );
}

// Renders a muted, single-line row of meta info (e.g. size · annotation count · created date),
// separating the (non-null) entries with a dot, similar to the dashboard mockup.
export function RowMetaLine({ items }: { items: React.ReactNode[] }) {
  const visibleItems = items.filter((item) => item != null);
  return (
    <div className="dashboard-row-meta">
      {visibleItems.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are a stable, ordered list for a given row
        <span className="dashboard-row-meta-item" key={index}>
          {index > 0 ? <span className="dashboard-row-meta-dot">·</span> : null}
          {item}
        </span>
      ))}
    </div>
  );
}
