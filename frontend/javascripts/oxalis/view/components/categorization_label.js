// @flow

import { Tag, Tooltip } from "antd";
import UserLocalStorage from "libs/user_local_storage";
import React, { useEffect } from "react";
import { stringToColor } from "libs/format_utils";

type LabelProps = {|
  tag: string,
  kind: string,
  onClick: MouseEvent => void,
  onClose: MouseEvent => void,
  closable: boolean,
|};

type FilterProps = {|
  searchTags: Array<string>,
  setTags: (Array<string>) => void,
  localStorageSavingKey: string,
|};

export default function CategorizationLabel({ tag, kind, onClick, onClose, closable }: LabelProps) {
  return (
    <Tooltip title={`Click to only show ${kind} with this tag.`}>
      <Tag color={stringToColor(tag)} onClick={onClick} onClose={onClose} closable={closable}>
        {tag}
      </Tag>
    </Tooltip>
  );
}

export function CategorizationSearch({ searchTags, setTags, localStorageSavingKey }: FilterProps) {
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
      setTags(searchTags.filter(currentTag => currentTag !== tag));
    }
  }

  return (
    <>
      {searchTags.map(tag => (
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
    </>
  );
}
