// @flow
import * as React from "react";

import { Form, Input, Select, Card } from "antd";
import messages from "messages";
import { isDatasetNameValid } from "admin/admin_rest_api";
import type { APIDataStore, APIUser } from "types/api_flow_types";

const FormItem = Form.Item;
export function CardContainer({
  children,
  withoutCard,
  title,
}: {
  children: React.Node,
  withoutCard?: boolean,
  title: string,
}) {
  if (withoutCard) {
    return <React.Fragment>{children}</React.Fragment>;
  } else {
    return (
      <Card
        style={{ maxWidth: 1200, marginLeft: "auto", marginRight: "auto" }}
        bordered={false}
        title={<h3>{title}</h3>}
      >
        {children}
      </Card>
    );
  }
}

export function DatasetNameFormItem({ activeUser }: { activeUser: ?APIUser }) {
  return (
    <FormItem
      name="name"
      label="Dataset Name"
      hasFeedback
      rules={[
        { required: true, message: messages["dataset.import.required.name"] },
        { min: 3 },
        { pattern: /[0-9a-zA-Z_-]+$/ },
        {
          validator: async (_rule, value) => {
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
      ]}
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
  datastores: Array<APIDataStore>,
  hidden?: boolean,
}) {
  return (
    <FormItem
      name="datastore"
      label="Datastore"
      hasFeedback
      hidden={hidden || false}
      rules={[{ required: true, message: messages["dataset.import.required.datastore"] }]}
      initialValue={datastores.length ? datastores[0] : null}
    >
      <Select
        showSearch
        placeholder="Select a Datastore"
        optionFilterProp="label"
        style={{ width: "100%" }}
        options={datastores.map((datastore: APIDataStore) => ({
          label: datastore.name,
          value: datastore,
        }))}
      />
    </FormItem>
  );
}
