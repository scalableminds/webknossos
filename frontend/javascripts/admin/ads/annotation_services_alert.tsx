import { TeamOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";

export default function AnnotationServicesAd() {
  return (
    <Alert
      type="info"
      showIcon
      icon={<TeamOutlined />}
      title="Need more workforce for annotating your dataset?"
      description="Have a look at our annotation services."
      action={
        <Button
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
