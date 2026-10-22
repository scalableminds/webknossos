import { PlusOutlined } from "@ant-design/icons";
import { Space } from "antd";
import type React from "react";
import type { APIAnnotationInfo } from "types/api_types";
import CategorizationLabel from "viewer/view/components/categorization_label";
import EditableTextIcon from "viewer/view/components/editable_text_icon";

// The tags of an annotation, as shown in the annotation list and its details sidebar.
export function AnnotationTags({
  annotation,
  isEditable,
  onClickTag,
  onAddTag,
  onRemoveTag,
  className,
}: {
  annotation: APIAnnotationInfo;
  isEditable: boolean;
  onClickTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string, event: React.SyntheticEvent) => void;
  className?: string;
}) {
  return (
    <Space wrap className={className}>
      {annotation.tags.map((tag) => (
        <CategorizationLabel
          key={tag}
          kind="annotations"
          onClick={() => onClickTag(tag)}
          onClose={(event) => onRemoveTag(tag, event)}
          tag={tag}
          // The dataset name tag is added automatically and can't be removed.
          closable={isEditable && tag !== annotation.dataSetName}
        />
      ))}
      {isEditable ? (
        <EditableTextIcon icon={<PlusOutlined />} onChange={onAddTag} label="Add Tag" />
      ) : null}
    </Space>
  );
}
