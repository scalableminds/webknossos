import { Modal, Form, AutoComplete, Input } from "antd";
import * as React from "react";
const FormItem = Form.Item;
type Props = {
  //   onOk: (...args: Array<any>) => any;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
};

function EditTeamModalForm({ onCancel, isOpen }: Props) {
  //onOk: onOkCallback, onCancel,
  const [form] = Form.useForm();
  const options = [
    { value: 'Burns Bay Road' },
    { value: 'Downing Street' },
    { value: 'Wall Street' },
  ];
  return (
    <>
      <Modal open={isOpen} onCancel={onCancel} title="Add / Remove Users" okText="Ok">
        <Form layout="vertical" form={form}>
          <AutoComplete
            options={options}
            filterOption={(inputValue, option) =>
              option!.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
            }
          >
            <Input.Search size="large" placeholder="input here" />
          </AutoComplete>
        </Form>
      </Modal>
    </>
  );
}

const EditTeamModalView = EditTeamModalForm;
export default EditTeamModalView;
