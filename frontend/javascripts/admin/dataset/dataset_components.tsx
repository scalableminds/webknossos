import { Card, Form, type FormInstance, Input, Select } from "antd";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import features from "features";
import messages from "messages";
import type * as React from "react";
import type { APIDataStore, APITeam, APIUser } from "types/api_flow_types";
import { syncValidator } from "types/validation";

const FormItem = Form.Item;
export function CardContainer({
  children,
  withoutCard,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  withoutCard?: boolean;
  title: string;
  subtitle?: JSX.Element;
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
        title={
          <>
            <h3 style={{ lineHeight: "10px", marginTop: subtitle != null ? "22px" : "12px" }}>
              {title}
            </h3>
            <span style={{ fontSize: 12, marginTop: 0, color: "grey" }}>{subtitle}</span>
          </>
        }
      >
        {children}
      </Card>
    );
  }
}
const sharedRules = [
  {
    min: 1,
  },
  {
    validator: syncValidator(
      (value: string | null) => !value || !value.startsWith("."),
      "The name must not start with a dot.",
    ),
  },
];

export const layerNameRules = [
  ...sharedRules,
  {
    pattern: /^[0-9a-zA-Z_.\-$.]+$/,
    message: "Only letters, digits and the following characters are allowed: . _ - $",
  },
];

export const getDatasetNameRules = (activeUser: APIUser | null | undefined) => [
  {
    required: true,
    message: messages["dataset.import.required.name"],
  },
  { min: 3, message: messages["dataset.name_length"] },
  ...layerNameRules,
  {
    pattern: /^[0-9a-zA-Z_.-]+$/,
    message: "Only letters, digits and the following characters are allowed: . _ -",
  },
  {
    validator: async () => {
      if (!activeUser) throw new Error("Can't do operation if no user is logged in.");
      return Promise.resolve();
    },
  },
];

export function DatasetNameFormItem({
  activeUser,
  initialName,
  label,
  disabled,
}: {
  activeUser: APIUser | null | undefined;
  initialName?: string;
  label?: string;
  allowDuplicate?: boolean;
  disabled?: boolean;
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
      <Input disabled={disabled} />
    </FormItem>
  );
}
export function DatastoreFormItem({
  datastores,
  hidden,
  disabled,
}: {
  datastores: Array<APIDataStore>;
  hidden?: boolean;
  disabled?: boolean;
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
        disabled={disabled}
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
  afterFetchedTeams,
  formRef,
  disabled,
}: {
  isDatasetManagerOrAdmin: boolean;
  selectedTeams: APITeam | Array<APITeam>;
  setSelectedTeams: (teams: APITeam | Array<APITeam>) => void;
  afterFetchedTeams?: (arg0: Array<APITeam>) => void;
  formRef: React.RefObject<FormInstance<any>>;
  disabled?: boolean;
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
        disabled={disabled}
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
          if (afterFetchedTeams) {
            afterFetchedTeams(fetchedTeams);
          }
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
