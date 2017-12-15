// @flow
import _ from "lodash";
import * as React from "react";
import Request from "libs/request";

type Props = {
  multiple: boolean,
  accept: string,
  url?: string,
  name: string,
  children?: React.Node,
  onSuccess?: Function,
  onError?: Function,
  onUploading?: Function,
};

class FileUpload extends React.PureComponent<Props> {
  fileInput: ?HTMLInputElement;

  upload = (event: SyntheticInputEvent<>) => {
    const files = event.target.files;

    if (this.props.onUploading) {
      this.props.onUploading();
    }

    const successCallback = this.props.onSuccess ? this.props.onSuccess : _.noop;
    const errorCallback = this.props.onError ? this.props.onError : _.noop;

    if (this.props.url) {
      Request.sendMultipartFormReceiveJSON(this.props.url, {
        data: { [this.props.name]: files },
      }).then(successCallback, errorCallback);
    } else {
      const reader = new FileReader();
      reader.onerror = errorCallback;
      reader.onload = () => successCallback(reader.result);
      reader.readAsText(files[0]);
    }
  };

  render() {
    const { multiple, accept, name } = this.props;

    return (
      <span
        onClick={() => {
          if (this.fileInput) {
            this.fileInput.click();
          }
        }}
      >
        <input
          multiple={multiple}
          accept={accept}
          name={name}
          type="file"
          ref={element => {
            this.fileInput = element;
          }}
          style={{ display: "none" }}
          onChange={this.upload}
          value=""
        />
        {this.props.children}
      </span>
    );
  }
}

export default FileUpload;
