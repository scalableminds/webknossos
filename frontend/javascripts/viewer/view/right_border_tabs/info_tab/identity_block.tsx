import { EditOutlined, SettingOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import Markdown from "libs/markdown_adapter";
import { mayUserEditDataset } from "libs/utils";
import { useState } from "react";
import { useDispatch } from "react-redux";
import type { APIDataset, APIUser } from "types/api_types";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import {
  setAnnotationDescriptionAction,
  setAnnotationNameAction,
} from "viewer/model/actions/annotation_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/bounding_box_creation_helpers";
import { MarkdownModal } from "../../components/markdown_modal";
import { InlineIconButton } from "./info_tab_layout";

/**
 * The identity block heading the panel: the one dark title of the panel plus its
 * description, each with its own edit affordance inline right after the text.
 *
 * Empty states are not disabled states — the placeholder text opens the same editor as the
 * pencil next to it.
 */

export function AnnotationIdentityBlock({
  name,
  description,
  mayEdit,
}: {
  name: string;
  description: string;
  mayEdit: boolean;
}) {
  const dispatch = useDispatch();
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);

  const setName = (newName: string) => dispatch(setAnnotationNameAction(newName));
  const setDescription = async (newDescription: string) => {
    // Defer the actual update until any active rebase/forwarding has finished, so an edit
    // submitted mid-rebase isn't lost.
    await waitUntilRebaseFinished();
    dispatch(setAnnotationDescriptionAction(newDescription));
  };

  const isNameEmpty = name === "";
  const isDescriptionEmpty = description === "";

  return (
    <div className="info-tab-identity">
      <div className="info-tab-identity-line">
        {mayEdit ? (
          <Typography.Text
            className={`info-tab-title ${isNameEmpty ? "info-tab-muted" : ""}`}
            editable={{
              onChange: setName,
              editing: isEditingName,
              onStart: () => setIsEditingName(true),
              onEnd: () => setIsEditingName(false),
              onCancel: () => setIsEditingName(false),
              // The inline pencil below is the only affordance — antd's own icon would
              // duplicate it, and "text" additionally lets the empty state click through.
              triggerType: ["text"],
            }}
          >
            {isNameEmpty ? "Unnamed annotation" : name}
          </Typography.Text>
        ) : (
          <Typography.Text className={`info-tab-title ${isNameEmpty ? "info-tab-muted" : ""}`}>
            {isNameEmpty ? "Unnamed annotation" : name}
          </Typography.Text>
        )}
        {mayEdit && !isEditingName ? (
          <InlineIconButton
            icon={<EditOutlined />}
            tooltip="Rename annotation"
            ariaLabel="Rename annotation"
            onClick={() => setIsEditingName(true)}
          />
        ) : null}
      </div>

      <div className="info-tab-identity-line info-tab-description">
        {isDescriptionEmpty ? (
          <Typography.Text
            className="info-tab-muted"
            onClick={mayEdit ? () => setIsMarkdownModalOpen(true) : undefined}
          >
            {mayEdit ? "Add a description…" : "No description"}
          </Typography.Text>
        ) : (
          <Markdown>{description}</Markdown>
        )}
        {mayEdit ? (
          <InlineIconButton
            icon={<EditOutlined />}
            tooltip="Edit description"
            ariaLabel="Edit description"
            onClick={() => setIsMarkdownModalOpen(true)}
          />
        ) : null}
      </div>

      {mayEdit ? (
        <MarkdownModal
          label="Annotation Description"
          placeholder="[No description]"
          source={description}
          isOpen={isMarkdownModalOpen}
          onOk={() => setIsMarkdownModalOpen(false)}
          onChange={setDescription}
        />
      ) : null}
    </div>
  );
}

export function DatasetIdentityBlock({
  dataset,
  activeUser,
}: {
  dataset: APIDataset;
  activeUser: APIUser | null | undefined;
}) {
  return (
    <div className="info-tab-identity">
      <div className="info-tab-identity-line">
        <Typography.Text className="info-tab-title">{dataset.name}</Typography.Text>
        <DatasetSettingsButton dataset={dataset} activeUser={activeUser} />
      </div>
      {dataset.description ? (
        <div className="info-tab-description">
          <Markdown>{dataset.description}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

/** Renders nothing for users who may not edit the dataset. */
export function DatasetSettingsButton({
  dataset,
  activeUser,
}: {
  dataset: APIDataset;
  activeUser: APIUser | null | undefined;
}) {
  if (!mayUserEditDataset(activeUser, dataset)) {
    return null;
  }

  return (
    <InlineIconButton
      icon={<SettingOutlined />}
      tooltip="Dataset settings"
      ariaLabel="Dataset settings"
      to={`/datasets/${getReadableURLPart(dataset)}/edit`}
      isSecondary
    />
  );
}
