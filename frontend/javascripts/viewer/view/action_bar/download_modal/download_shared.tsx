import { CopyOutlined } from "@ant-design/icons";
import { Button, Divider, Flex, Row, Typography } from "antd";
import Toast from "libs/toast";
import messages from "messages";

export function Hint({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <Typography.Text style={{ ...style, fontSize: 12 }}>{children}</Typography.Text>;
}

export function MoreInfoHint() {
  return (
    <Flex justify="center">
      <Hint>
        For more information on how to work with annotations and datasets visit the{" "}
        <a
          href="https://docs.webknossos.org/webknossos/data/export_ui.html"
          target="_blank"
          rel="noreferrer"
        >
          user documentation
        </a>
        .
      </Hint>
    </Flex>
  );
}

async function copyToClipboard(code: string) {
  await navigator.clipboard.writeText(code);
  Toast.success("Snippet copied to clipboard.");
}

export function CopyableCodeSnippet({ code, onCopy }: { code: string; onCopy?: () => void }) {
  return (
    <pre>
      <Button
        style={{
          float: "right",
          border: "none",
          width: "18px",
          height: "16px",
          background: "transparent",
        }}
        onClick={() => {
          copyToClipboard(code);
          if (onCopy) {
            onCopy();
          }
        }}
        icon={<CopyOutlined />}
      />
      {code}
    </pre>
  );
}

export function WorkerInfo() {
  return (
    <Row>
      <Divider />
      <Typography.Paragraph type="warning">
        {messages["annotation.export_no_worker"]}
        <a href="mailto:hello@webknossos.org">hello@webknossos.org.</a>
      </Typography.Paragraph>
    </Row>
  );
}
