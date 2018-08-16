// @flow
import * as React from "react";
import { Modal, Button, Row, Col } from "antd";
import Markdown from "react-remarkable";
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
      title={
        <span>
          {`Edit ${label}`} (
          <a href="https://markdown-it.github.io/" target="_blank" rel="noopener noreferrer">
            Markdown enabled
          </a>
          )
        </span>
      }
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
      <Row gutter={16}>
        <Col span={12}>
          <InputComponent
            value={source}
            placeholder={`Add ${label}`}
            onChange={onChange}
            rows={5}
            autosize={{ minRows: 5, maxRows: 20 }}
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
