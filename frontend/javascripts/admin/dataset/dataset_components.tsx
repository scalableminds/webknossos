import * as React from "react";
import { Form, Input, Select, Card, FormInstance } from "antd";
import messages from "messages";
import { isDatasetNameValid } from "admin/admin_rest_api";
import type { APIDataStore, APITeam, APIUser } from "types/api_flow_types";
import { syncValidator } from "types/validation";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import features from "features";

const FormItem = Form.Item;
export function CardContainer({
  children,
  withoutCard,
  title,
}: {
  children: React.ReactNode;
  withoutCard?: boolean;
  title: string;
}) {
  if (withoutCard) {
    return <>{children}</>;
  } else {
    return (
      <Card
        style={{
          maxWidth: 1200,
          marginLeft: "auto",
          marginRight: "auto",
        }}
        bordered={false}
        title={<h3>{title}</h3>}
      >
        {children}
      </Card>
    );
  }
}
export const layerNameRules = [
  {
    min: 1,
  },
  // Note that these rules are also checked by the backend
  {
    pattern: /^[0-9a-zA-Z_.-]+$/,
    message: "Only letters, digits and the following characters are allowed: . _ -",
  },
  {
    validator: syncValidator(
      (value: string | null) => !value || !value.startsWith("."),
      "The name must not start with a dot.",
    ),
  },
];

export const getDatasetNameRules = (
  activeUser: APIUser | null | undefined,
  allowRenaming: boolean = true,
) => [
  {
    required: true,
    message: messages["dataset.import.required.name"],
  },
  { min: 3, message: messages["dataset.name_length"] },
  ...layerNameRules,
  {
    validator: async (_rule: any, value: string) => {
      if (!allowRenaming) {
        // Renaming is not allowed. No need to validate the (existing) name then.
        return Promise.resolve();
      }
      if (!activeUser) throw new Error("Can't do operation if no user is logged in.");
      const reasons = await isDatasetNameValid({
        name: value,
        owningOrganization: activeUser.organization,
      });

      if (reasons != null) {
        return Promise.reject(reasons);
      } else {
        return Promise.resolve();
      }
    },
  },
];

export function DatasetNameFormItem({
  activeUser,
  initialName,
  label,
}: {
  activeUser: APIUser | null | undefined;
  initialName?: string;
  label?: string;
}) {
  return (
    <FormItem
      name="name"
      label={label || "Dataset Name"}
      hasFeedback
      initialValue={initialName}
      rules={getDatasetNameRules(activeUser)}
      validateFirst
    >
      <Input />
    </FormItem>
  );
}
export function DatastoreFormItem({
  datastores,
  hidden,
}: {
  datastores: Array<APIDataStore>;
  hidden?: boolean;
}) {
  return (
    <FormItem
      name="datastoreUrl"
      label="Datastore"
      hasFeedback
      hidden={hidden || false}
      rules={[
        {
          required: true,
          message: messages["dataset.import.required.datastore"],
        },
      ]}
      initialValue={datastores.length ? datastores[0].url : null}
    >
      <Select
        showSearch
        placeholder="Select a Datastore"
        optionFilterProp="label"
        style={{
          width: "100%",
        }}
        options={datastores.map((datastore: APIDataStore) => ({
          label: datastore.name,
          value: datastore.url,
        }))}
      />
    </FormItem>
  );
}

export function AllowedTeamsFormItem({
  isDatasetManagerOrAdmin,
  selectedTeams,
  setSelectedTeams,
  formRef,
}: {
  isDatasetManagerOrAdmin: boolean;
  selectedTeams: APITeam | Array<APITeam>;
  setSelectedTeams: (teams: APITeam | Array<APITeam>) => void;
  formRef: React.RefObject<FormInstance<any>>;
}) {
  return (
    <FormItemWithInfo
      name="initialTeams"
      label="Teams allowed to access this dataset"
      info="The dataset can be seen by administrators, dataset managers and by teams that have access to the folder to which the dataset is uploaded. If you want to grant additional teams access, define these teams here."
      hasFeedback
    >
      <TeamSelectionComponent
        mode="multiple"
        value={selectedTeams}
        allowNonEditableTeams={isDatasetManagerOrAdmin}
        onChange={(selectedTeams) => {
          if (formRef.current == null) return;

          if (!Array.isArray(selectedTeams)) {
            // Making sure that we always have an array even when only one team is selected.
            selectedTeams = [selectedTeams];
          }

          formRef.current.setFieldsValue({
            initialTeams: selectedTeams,
          });
          setSelectedTeams(selectedTeams);
        }}
        afterFetchedTeams={(fetchedTeams) => {
          if (!features().isWkorgInstance) {
            return;
          }

          const teamOfOrganization = fetchedTeams.find((team) => team.name === team.organization);

          if (teamOfOrganization == null) {
            return;
          }

          if (formRef.current == null) return;
          formRef.current.setFieldsValue({
            initialTeams: [teamOfOrganization],
          });
          setSelectedTeams([teamOfOrganization]);
        }}
      />
    </FormItemWithInfo>
  );
}
