import { Form, Input, type InputRef, Modal, Spin } from "antd";
import { useDatasetCollectionContext } from "dashboard/dataset/dataset_collection_context";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import { useFolderQuery } from "dashboard/dataset/queries";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import Shortcut from "libs/shortcut_component";
import { useEffect, useRef } from "react";

import type { APITeam } from "types/api_flow_types";

export function EditFolderModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { data: folder, isFetching } = useFolderQuery(folderId);
  const [form] = Form.useForm();
  const context = useDatasetCollectionContext();
  const inputElement = useRef<InputRef>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: This is an intentional side effect to focus the input element.
  useEffect(() => {
    if (inputElement.current) {
      inputElement.current.focus();
    }
  }, [inputElement.current, isFetching]);

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
            <Input value={folder.name} ref={inputElement} />
          </FormItemWithInfo>
          <FormItemWithInfo
            name="allowedTeams"
            label="Access Permissions"
            info="Teams which may access this folder. Note that teams that can access a parent folder of this folder, will always be able to also access this folder."
          >
            <TeamSelectionComponent mode="multiple" allowNonEditableTeams />
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
