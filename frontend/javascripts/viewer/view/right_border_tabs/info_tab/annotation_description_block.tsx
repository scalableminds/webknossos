import { EditOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import Markdown from "libs/markdown_adapter";
import { useWkSelector } from "libs/react_hooks";
import type { CSSProperties } from "react";
import { useDispatch } from "react-redux";
import { mayEditAnnotationProperties } from "viewer/model/accessors/annotation_accessor";
import { setAnnotationDescriptionAction } from "viewer/model/actions/annotation_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/bounding_box_creation_helpers";
import { MarkdownModal } from "../../components/markdown_modal";

type Props = {
  isMarkdownModalOpen: boolean;
  setIsMarkdownModalOpen: (isOpen: boolean) => void;
};

export function AnnotationDescriptionBlock({ isMarkdownModalOpen, setIsMarkdownModalOpen }: Props) {
  const dispatch = useDispatch();
  const annotationDescription = useWkSelector((state) => state.annotation.description);
  const mayEditAnnotation = useWkSelector(mayEditAnnotationProperties);

  const isDescriptionEmpty = annotationDescription === "";
  const description = isDescriptionEmpty ? (
    "[no description]"
  ) : (
    <Markdown>{annotationDescription}</Markdown>
  );

  if (!mayEditAnnotation) {
    return (
      <div className="info-tab-block">
        <p className="sidebar-label">Description</p>
        <Markdown>{annotationDescription || "[no description]"}</Markdown>
      </div>
    );
  }

  const buttonStylesForMarkdownRendering: CSSProperties = isDescriptionEmpty
    ? {}
    : {
        position: "absolute",
        right: 10,
        bottom: 0,
      };

  const onChangeDescription = async (comment: string) => {
    // Defer the actual update until any active rebase/forwarding has finished, so an edit
    // submitted mid-rebase isn't lost.
    await waitUntilRebaseFinished();
    dispatch(setAnnotationDescriptionAction(comment));
  };

  return (
    <div className="info-tab-block">
      <p className="sidebar-label">Description</p>
      <div style={{ position: "relative" }}>
        <Typography.Text>
          {description}
          <FastTooltip title="Edit">
            {/* biome-ignore lint/a11y/useFocusableInteractive: don't use <button> to not mess with its default styles */}
            {/* biome-ignore lint/a11y/useSemanticElements: don't use <button> to not mess with its default styles */}
            <div
              role="button"
              className="ant-typography-edit"
              style={{
                display: "inline-block",
                ...buttonStylesForMarkdownRendering,
              }}
              onClick={() => setIsMarkdownModalOpen(true)}
            >
              <EditOutlined />
            </div>
          </FastTooltip>
        </Typography.Text>
      </div>
      <MarkdownModal
        label="Annotation Description"
        placeholder="[No description]"
        source={annotationDescription}
        isOpen={isMarkdownModalOpen}
        onOk={() => setIsMarkdownModalOpen(false)}
        onChange={onChangeDescription}
      />
    </div>
  );
}
