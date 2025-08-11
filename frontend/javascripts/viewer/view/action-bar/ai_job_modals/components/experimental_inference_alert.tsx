import { Alert } from "antd";

export function ExperimentalInferenceAlert() {
  return (
    <Alert
      message="Please note that this feature is experimental and currently only works with electron microscopy data.  If the specified bounding box is too close to the border of the dataset's bounding box, its size might be reduced automatically."
      type="warning"
      showIcon
    />
  );
}
