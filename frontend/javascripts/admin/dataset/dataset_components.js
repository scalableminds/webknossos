// @flow
import * as React from "react";

import { Form, Input, Select, Card } from "antd";
import messages from "messages";
import { isDatasetNameValid } from "admin/admin_rest_api";
import type { APIDataStore, APIUser } from "admin/api_flow_types";

const FormItem = Form.Item;
const { Option } = Select;

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

export function DatasetNameFormItem({ form, activeUser }: { form: Object, activeUser: ?APIUser }) {
  const { getFieldDecorator } = form;
  return (
    <FormItem label="Dataset Name" hasFeedback>
      {getFieldDecorator("name", {
        rules: [
          { required: true, message: messages["dataset.import.required.name"] },
          { min: 3 },
          { pattern: /[0-9a-zA-Z_-]+$/ },
          {
            validator: async (_rule, value, callback) => {
              if (!activeUser) throw new Error("Can't do operation if no user is logged in.");
              const reasons = await isDatasetNameValid({
                name: value,
                owningOrganization: activeUser.organization,
              });
              if (reasons != null) {
                callback(reasons);
              } else {
                callback();
              }
            },
          },
        ],
        validateFirst: true,
      })(<Input />)}
    </FormItem>
  );
}

export function DatastoreFormItem({
  form,
  datastores,
}: {
  form: Object,
  datastores: Array<APIDataStore>,
}) {
  const { getFieldDecorator } = form;
  return (
    <FormItem label="Datastore" hasFeedback>
      {getFieldDecorator("datastore", {
        rules: [{ required: true, message: messages["dataset.import.required.datastore"] }],
        initialValue: datastores.length ? datastores[0].url : null,
      })(
        <Select
          showSearch
          placeholder="Select a Datastore"
          optionFilterProp="children"
          style={{ width: "100%" }}
        >
          {datastores.map((datastore: APIDataStore) => (
            <Option key={datastore.name} value={datastore.url}>
              {`${datastore.name}`}
            </Option>
          ))}
        </Select>,
      )}
    </FormItem>
  );
}
