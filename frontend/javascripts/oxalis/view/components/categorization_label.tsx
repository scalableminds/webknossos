import { Tag, Tooltip } from "antd";
import UserLocalStorage from "libs/user_local_storage";
import { type MouseEventHandler, useEffect } from "react";
import { stringToColor } from "libs/format_utils";
import { useEffectOnlyOnce } from "libs/react_hooks";
type LabelProps = {
  tag: string;
  kind: string;
  onClick: MouseEventHandler<HTMLSpanElement>;
  onClose: MouseEventHandler<HTMLSpanElement>;
  closable: boolean;
};
type FilterProps = {
  itemName: string;
  searchTags: Array<string>;
  setTags: (arg0: Array<string>) => void;
  localStorageSavingKey: string;
};
const LOCKED_TAG_COLOR = "var(--ant-color-warning)";
export default function CategorizationLabel({ tag, kind, onClick, onClose, closable }: LabelProps) {
  const color = tag === "locked" ? LOCKED_TAG_COLOR : stringToColor(tag);
  return (
    <Tooltip title={`Click to only show ${kind} with this tag.`}>
      <Tag
        color={color}
        onClick={onClick}
        onClose={onClose}
        closable={closable}
        style={{
          cursor: "pointer",
        }}
      >
        {tag}
      </Tag>
    </Tooltip>
  );
}
export function CategorizationSearch({
  itemName,
  searchTags,
  setTags,
  localStorageSavingKey,
}: FilterProps) {
  useEffectOnlyOnce(() => {
    // restore the search query tags from the last session
    const searchTagString = UserLocalStorage.getItem(localStorageSavingKey);

    if (searchTagString) {
      try {
        const loadedSearchTags = JSON.parse(searchTagString);
        setTags(loadedSearchTags);
      } catch (_error) {
        // pass
      }
    }
  });
  useEffect(() => {
    // store newest the search query tags
    UserLocalStorage.setItem(localStorageSavingKey, JSON.stringify(searchTags));
  }, [searchTags, localStorageSavingKey]);

  function removeTag(tag: string) {
    if (searchTags.includes(tag)) {
      setTags(searchTags.filter((currentTag) => currentTag !== tag));
    }
  }

  if (searchTags.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ marginRight: 6 }}>Only showing {itemName} with these tags:</span>
      {searchTags.map((tag) => (
        <Tag
          key={tag}
          color={stringToColor(tag)}
          onClose={() => {
            removeTag(tag);
          }}
          closable
        >
          {tag}
        </Tag>
      ))}
    </div>
  );
}
