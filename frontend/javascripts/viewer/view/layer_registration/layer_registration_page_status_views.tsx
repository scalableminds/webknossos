import { Spin, Typography } from "antd";

// Shown instead of the layer registration pages while they load or when they can't be shown.

export function LayerRegistrationPageSpinner() {
  return <Spin style={{ margin: 40 }} />;
}

export function LayerRegistrationPageError({ text }: { text: string }) {
  return (
    <Typography.Text type="danger" style={{ display: "block", margin: 40 }}>
      {text}
    </Typography.Text>
  );
}
