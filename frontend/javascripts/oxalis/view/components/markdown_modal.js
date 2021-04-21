// @flow
import { Alert, Modal, Button, Row, Col } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";

import InputComponent from "oxalis/view/components/input_component";

function getFirstLine(comment: string) {
  const newLineIndex = comment.indexOf("\n");
  return comment.slice(0, newLineIndex !== -1 ? newLineIndex : undefined);
}

export function MarkdownWrapper({ source, singleLine }: { source: string, singleLine?: boolean }) {
  const content = singleLine ? getFirstLine(source) : source;
  return <Markdown source={content} options={{ html: false, breaks: true, linkify: true }} />;
}

export function MarkdownModal({
  source,
  visible,
  onOk,
  onChange,
  label,
}: {
  source: string,
  label: string,
  visible?: boolean,
  onOk: () => void,
  onChange: (SyntheticInputEvent<>) => void,
}) {
  return (
    <Modal
      key="comment-markdown-modal"
      title={<span>{`Edit ${label}`}</span>}
      visible={visible}
      onCancel={onOk}
      closable={false}
      width={700}
      footer={[
        <Button key="back" onClick={onOk}>
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
        style={{ marginBottom: 16 }}
      />
      <Row gutter={16}>
        <Col span={12}>
          <InputComponent
            value={source}
            placeholder={`Add ${label}`}
            onChange={onChange}
            rows={5}
            autoSize={{ minRows: 5, maxRows: 20 }}
            isTextArea
          />
        </Col>
        <Col span={12} style={{ maxHeight: 430, overflowY: "auto" }}>
          <MarkdownWrapper source={source} />
        </Col>
      </Row>
    </Modal>
  );
}
