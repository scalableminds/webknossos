import { Form, Input, Modal, Spin } from "antd";
import {
  type FolderModalState,
  useDatasetCollectionContext,
} from "dashboard/dataset/dataset_collection_context";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import { useFolderQuery } from "dashboard/dataset/queries";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import Shortcut from "libs/shortcut_component";
import { useEffect, useState } from "react";

import type { APITeam } from "types/api_types";

type FolderModalProps = FolderModalState & { onClose: () => void };

const ACCESS_PERMISSIONS_INFO =
  "Teams which may access this folder. Note that teams that can access a parent folder of this folder, will always be able to also access this folder.";

export function FolderModal(props: FolderModalProps) {
  if (props.mode === "edit") {
    return <EditFolderModalContent folderId={props.folderId} onClose={props.onClose} />;
  }
  return <CreateFolderModalContent parentFolderId={props.parentFolderId} onClose={props.onClose} />;
}

function EditFolderModalContent({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { data: folder, isFetching } = useFolderQuery(folderId);
  const [form] = Form.useForm();
  const context = useDatasetCollectionContext();
  // Holds the native input element instead of antd's InputRef: antd creates a new
  // InputRef object on every render, which would re-run the effect below each time.
  const [inputElement, setInputElement] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    inputElement?.focus();
  }, [inputElement]);

  const onSave = async () => {
    const name = form.getFieldValue("name");
    const allowedTeams = form.getFieldValue("allowedTeams") as APITeam[];

    if (folder == null) {
      return;
    }

    await context.queries.updateFolderMutation.mutateAsync({
      ...folder,
      id: folderId,
      name,
      allowedTeams: allowedTeams.map((t) => t.id),
    });

    onClose();
  };

  const content =
    // Don't initialize form when isFetching==true, because
    // this would populate the form with outdated initial values.
    folder != null && !isFetching ? (
      <div>
        <Shortcut keys="enter" onTrigger={onSave} supportInputElements />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ name: folder.name, allowedTeams: folder.allowedTeams }}
        >
          <FormItemWithInfo name="name" label="Name" info="Name of the folder">
            <Input
              value={folder.name}
              ref={(inputRef) => setInputElement(inputRef?.input ?? null)}
            />
          </FormItemWithInfo>
          <FormItemWithInfo
            name="allowedTeams"
            label="Access Permissions"
            info={ACCESS_PERMISSIONS_INFO}
          >
            <TeamSelectionComponent mode="multiple" allowNonEditableTeams allowManagingTeams />
          </FormItemWithInfo>
        </Form>
      </div>
    ) : (
      <Spin spinning />
    );

  return (
    <Modal title="Edit Folder" open onOk={onSave} onCancel={onClose}>
      {content}
    </Modal>
  );
}

function CreateFolderModalContent({
  parentFolderId,
  onClose,
}: {
  parentFolderId: string;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const context = useDatasetCollectionContext();
  // Holds the native input element instead of antd's InputRef: antd creates a new
  // InputRef object on every render, which would re-run the effect below each time.
  const [inputElement, setInputElement] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputElement) {
      inputElement.focus();
      inputElement.select();
    }
  }, [inputElement]);

  const onSave = async () => {
    const name = form.getFieldValue("name");
    const allowedTeams = (form.getFieldValue("allowedTeams") as APITeam[]) ?? [];

    if (!name) {
      return;
    }

    const newFolder = await context.queries.createFolderMutation.mutateAsync([
      parentFolderId,
      name,
    ]);

    if (allowedTeams.length > 0) {
      await context.queries.updateFolderMutation.mutateAsync({
        ...newFolder,
        allowedTeams: allowedTeams.map((t) => t.id),
      });
    }

    onClose();
  };

  return (
    <Modal title="New Folder" open okText="Create" onOk={onSave} onCancel={onClose}>
      <div>
        <Shortcut keys="enter" onTrigger={onSave} supportInputElements />
        <Form
          form={form}
          layout="vertical"
          initialValues={{ name: "New folder", allowedTeams: [] }}
        >
          <FormItemWithInfo name="name" label="Name" info="Name of the folder">
            <Input ref={(inputRef) => setInputElement(inputRef?.input ?? null)} />
          </FormItemWithInfo>
          <FormItemWithInfo
            name="allowedTeams"
            label="Access Permissions"
            info={ACCESS_PERMISSIONS_INFO}
          >
            <TeamSelectionComponent mode="multiple" allowNonEditableTeams allowManagingTeams />
          </FormItemWithInfo>
        </Form>
      </div>
    </Modal>
  );
}
