import { Divider, Modal, Row, Typography } from "antd";
import React from "react";
import { useFetch } from "libs/react_helpers";
import Toast from "libs/toast";
import messages from "messages";
import { getAuthToken } from "admin/admin_rest_api";
import { useSelector } from "react-redux";
import type { OxalisState } from "oxalis/store";
import { CopyableCodeSnippet, MoreInfoHint } from "./download_modal_view";
const { Paragraph, Text } = Typography;
type Props = {
  onClose: () => void;
};

export default function PythonClientModalView(props: Props): JSX.Element {
  const { onClose } = props;
  const isPythonClientModalOpen = useSelector(
    (state: OxalisState) => state.uiInformation.showPythonClientModal,
  );
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const dataset = useSelector((state: OxalisState) => state.dataset);

  const maybeShowWarning = () => (
    <Row>
      <Text
        style={{
          margin: "0 6px 12px",
        }}
        type="warning"
      >
        {activeUser != null
          ? messages["annotation.python_do_not_share"]
          : messages["annotation.register_for_token"]}
      </Text>
    </Row>
  );

  const authToken = useFetch(
    async () => {
      if (activeUser != null) {
        return getAuthToken();
      }
      return null;
    },
    "loading...",
    [activeUser],
  );
  const wkInitSnippet = `import webknossos as wk

with wk.webknossos_context(token="${authToken || "<insert token here>"}"):
dataset = wk.Dataset.download(
    url="${window.location.origin}",
    dataset="${dataset.name}"
    organization_id="${dataset.owningOrganization}",
)
`;

  const alertTokenIsPrivate = () => {
    Toast.warning(
      "The clipboard contains private data. Do not share this information with anyone you do not trust!",
    );
  };

  return (
    <Modal
      title="Python Client"
      visible={isPythonClientModalOpen}
      width={600}
      footer={null}
      onCancel={onClose}
      style={{ overflow: "visible" }}
    >
      <Row>
        <Text
          style={{
            margin: "0 6px 12px",
          }}
        >
          The following code snippets are suggestions to get you started quickly with the{" "}
          <a href="https://docs.webknossos.org/webknossos-py/" target="_blank" rel="noreferrer">
            webKnossos Python API
          </a>
          . To download and use this annotation in your Python project, simply copy and paste the
          code snippets to your script.
        </Text>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Code Snippets
      </Divider>
      {maybeShowWarning()}
      <Paragraph>
        <CopyableCodeSnippet code="pip install webknossos" />
        <CopyableCodeSnippet code={wkInitSnippet} onCopy={alertTokenIsPrivate} />
      </Paragraph>
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      <MoreInfoHint />
    </Modal>
  );
}
