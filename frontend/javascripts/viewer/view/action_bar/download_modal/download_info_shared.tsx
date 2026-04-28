import { CopyOutlined } from "@ant-design/icons";
import { Button, Divider, Row, Typography } from "antd";
import Toast from "libs/toast";
import messages from "messages";

export function Hint({
  children,
  style,
}: {
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <div style={{ ...style, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
      {children}
    </div>
  );
}

export function MoreInfoHint() {
  return (
    <Hint
      style={{
        margin: "0px 12px 0px 12px",
      }}
    >
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
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      <Typography.Text
        style={{
          margin: "0 6px 12px",
        }}
        type="warning"
      >
        {messages["annotation.export_no_worker"]}
        <a href="mailto:hello@webknossos.org">hello@webknossos.org.</a>
      </Typography.Text>
    </Row>
  );
}
