import { Tag, Tooltip } from "antd";
import UserLocalStorage from "libs/user_local_storage";
import React, { useEffect } from "react";
import { stringToColor } from "libs/format_utils";
type LabelProps = {
  tag: string;
  kind: string;
  onClick: (arg0: MouseEvent) => void;
  onClose: (arg0: MouseEvent) => void;
  closable: boolean;
};
type FilterProps = {
  itemName: string;
  searchTags: Array<string>;
  setTags: (arg0: Array<string>) => void;
  localStorageSavingKey: string;
};
export default function CategorizationLabel({ tag, kind, onClick, onClose, closable }: LabelProps) {
  return (
    <Tooltip title={`Click to only show ${kind} with this tag.`}>
      <Tag
        color={stringToColor(tag)}
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(arg0: MouseEvent) => void' is not assignabl... Remove this comment to see the full error message
        onClick={onClick}
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(arg0: MouseEvent) => void' is not assignabl... Remove this comment to see the full error message
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
  useEffect(() => {
    // restore the search query tags from the last session
    const searchTagString = UserLocalStorage.getItem(localStorageSavingKey);

    if (searchTagString) {
      try {
        const loadedSearchTags = JSON.parse(searchTagString);
        setTags(loadedSearchTags);
      } catch (error) {
        // pass
      }
    }
  }, []);
  useEffect(() => {
    // store newest the search query tags
    UserLocalStorage.setItem(localStorageSavingKey, JSON.stringify(searchTags));
  }, [searchTags]);

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
