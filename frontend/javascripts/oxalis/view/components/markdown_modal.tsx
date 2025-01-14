import { Alert, Button, Col, Input, Modal, Row } from "antd";
import Markdown from "libs/markdown_adapter";
import * as React from "react";

function getFirstLine(comment: string) {
  const newLineIndex = comment.indexOf("\n");
  return comment.slice(0, newLineIndex !== -1 ? newLineIndex : undefined);
}

export function MarkdownWrapper({ source, singleLine }: { source: string; singleLine?: boolean }) {
  const content = singleLine ? getFirstLine(source) : source;
  return <Markdown>{content}</Markdown>;
}

export function MarkdownModal({
  source,
  isOpen,
  onOk,
  onChange,
  label,
  placeholder,
}: {
  source: string;
  label: string;
  isOpen?: boolean;
  placeholder?: string;
  onOk: () => void;
  onChange: (newValue: string) => void;
}) {
  const placeholderText = placeholder ? placeholder : `Add ${label}`;
  const [currentValue, setCurrentValue] = React.useState(source);

  const onConfirm = () => {
    onChange(currentValue);
    onOk();
  };

  const setCurrentValueFromEvent = (
    event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    setCurrentValue(event.target.value);
  };

  return (
    <Modal
      key="comment-markdown-modal"
      title={<span>{`Edit ${label}`}</span>}
      open={isOpen}
      onCancel={onOk}
      closable={true}
      width={700}
      footer={[
        <Button key="back" onClick={onConfirm}>
          Ok
        </Button>,
      ]}
    >
      <Alert
        message={
          <React.Fragment>
            In addition to using{" "}
            <a href="https://markdown-it.github.io/" target="_blank" rel="noopener noreferrer">
              Markdown
            </a>{" "}
            for formatting, you can also create links to nodes and positions by using hashtags. For
            example, <code>#123</code> links to node 123, while <code>#(1,2,3)</code> points to the
            position 1,2,3.
          </React.Fragment>
        }
        type="info"
        style={{
          marginBottom: 16,
        }}
      />
      <Row gutter={16}>
        <Col span={12}>
          <Input.TextArea
            defaultValue={currentValue}
            placeholder={placeholderText}
            onChange={setCurrentValueFromEvent}
            rows={5}
            autoSize={{
              minRows: 5,
              maxRows: 20,
            }}
          />
        </Col>
        <Col
          span={12}
          style={{
            maxHeight: 430,
            overflowY: "auto",
          }}
        >
          <MarkdownWrapper source={currentValue} />
        </Col>
      </Row>
    </Modal>
  );
}
