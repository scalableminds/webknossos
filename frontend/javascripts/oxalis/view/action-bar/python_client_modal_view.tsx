import { Divider, Modal, Row, Typography } from "antd";
import React from "react";
import { useFetch, makeComponentLazy } from "libs/react_helpers";
import Toast from "libs/toast";
import messages from "messages";
import { getAuthToken } from "admin/admin_rest_api";
import { useSelector } from "react-redux";
import type { OxalisState } from "oxalis/store";
import { CopyableCodeSnippet, MoreInfoHint } from "./download_modal_view";
const { Paragraph, Text } = Typography;
type Props = {
  isOpen: boolean;
  onClose: () => void;
};

function _PythonClientModalView(props: Props): JSX.Element {
  const { isOpen, onClose } = props;
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

  const nonDefaultHost = !document.location.host.endsWith("webknossos.org");
  const indention = "\n        ";
  const contextUrlAddendum = nonDefaultHost ? `, url="${window.location.origin}"` : "";
  const maybeUrlParameter = nonDefaultHost
    ? `${indention}webknossos_url="${window.location.origin}"`
    : "";

  const wkInitSnippet = `import webknossos as wk

with wk.webknossos_context(token="${authToken || "<insert token here>"}"${contextUrlAddendum}):
    # Download the dataset.
    dataset = wk.Dataset.download(
        dataset_name_or_url="${dataset.name}",
        organization_id="${dataset.owningOrganization}",${maybeUrlParameter}
    )
    # Alternatively, directly open the dataset. Image data will be
    # streamed when being accessed.
    remote_dataset = wk.Dataset.open_remote(
        dataset_name_or_url="${dataset.name}",
        organization_id="${dataset.owningOrganization}",${maybeUrlParameter}
    )
`;

  const alertTokenIsPrivate = () => {
    if (authToken) {
      Toast.warning(
        "The clipboard contains private data. Do not share this information with anyone you do not trust!",
      );
    }
  };

  return (
    <Modal
      title="Python Client"
      open={isOpen}
      width={800}
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
            WEBKNOSSOS Python API
          </a>
          . To download and use this dataset in your Python project, simply copy and paste the code
          snippets to your script.
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

const PythonClientModalView = makeComponentLazy(_PythonClientModalView);
export default PythonClientModalView;
