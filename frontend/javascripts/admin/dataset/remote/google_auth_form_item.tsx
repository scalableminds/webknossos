import { UnlockOutlined } from "@ant-design/icons";
import type { FileList } from "admin/dataset/composition_wizard/common.ts";
import { Form, Upload } from "antd";
import { Fragment } from "react";
import { Unicode } from "viewer/constants";

import type { UploadChangeParam, UploadFile } from "antd/lib/upload";

const FormItem = Form.Item;

export function GoogleAuthFormItem({
  fileList,
  handleChange,
  showOptionalHint,
}: {
  fileList: FileList;
  handleChange: (arg: UploadChangeParam<UploadFile<any>>) => void;
  showOptionalHint?: boolean;
}) {
  return (
    <FormItem
      name="authFile"
      label={
        <Fragment>
          Google{Unicode.NonBreakingSpace}
          <a
            href="https://cloud.google.com/iam/docs/creating-managing-service-account-keys"
            target="_blank"
            rel="noopener noreferrer"
          >
            Service Account
          </a>
          {Unicode.NonBreakingSpace}Key {showOptionalHint && "(Optional)"}
        </Fragment>
      }
      hasFeedback
    >
      <Upload.Dragger
        name="files"
        fileList={fileList}
        onChange={handleChange}
        beforeUpload={() => false}
      >
        <p className="ant-upload-drag-icon">
          <UnlockOutlined
            style={{
              margin: 0,
              fontSize: 35,
            }}
          />
        </p>
        <p className="ant-upload-text">
          Click or Drag your Google Cloud Authentication File to this Area to Upload
        </p>
        <p className="ant-upload-text-hint">
          This is only needed if the dataset is located in a non-public Google Cloud Storage bucket
        </p>
      </Upload.Dragger>
    </FormItem>
  );
}
