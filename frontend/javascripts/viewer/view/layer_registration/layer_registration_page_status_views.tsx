import { Button, Result, Spin } from "antd";
import { Link } from "react-router";

// Shown instead of the layer registration pages while they load or when they can't be shown.

export function LayerRegistrationPageSpinner() {
  return <Spin style={{ margin: 40 }} />;
}

// The page can't do anything else, so the error offers the way back to the dashboard.
export function LayerRegistrationPageError({ text }: { text: string }) {
  return (
    <Result
      status="warning"
      title={text}
      extra={
        <Link to="/dashboard">
          <Button type="primary">Back to Dashboard</Button>
        </Link>
      }
    />
  );
}
