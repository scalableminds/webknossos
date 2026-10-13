import { Spin, Typography } from "antd";

// Shown instead of the alignment pages while they load or when they can't be shown.

export function AlignmentPageSpinner() {
  return <Spin style={{ margin: 40 }} />;
}

export function AlignmentPageError({ text }: { text: string }) {
  return (
    <Typography.Text type="danger" style={{ display: "block", margin: 40 }}>
      {text}
    </Typography.Text>
  );
}
