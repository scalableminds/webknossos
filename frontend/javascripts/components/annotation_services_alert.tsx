import { TeamOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";

export default function AnnotationServicesAlert() {
  return (
    <Alert
      type="info"
      showIcon
      icon={<TeamOutlined />}
      message="Need more workforce for annotating your dataset?"
      description="Have a look at our annotation services."
      action={
        <Button
          size="small"
          href="https://webknossos.org/services/annotations"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn More
        </Button>
      }
    />
  );
}
