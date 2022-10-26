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
  isVisible: boolean;
  onClose: () => void;
};

function _PythonClientModalView(props: Props): JSX.Element {
  const { isVisible, onClose } = props;
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
    # Download the dataset.
    dataset = wk.Dataset.download(
        webknossos_url="${window.location.origin}",
        dataset_name_or_url="${dataset.name}",
        organization_id="${dataset.owningOrganization}",
    )
    # Alternatively, directly open the dataset. Image data will be
    # streamed when being accessed.
    remote_dataset = wk.Dataset.open_remote(
        webknossos_url="${window.location.origin}",
        dataset_name_or_url="${dataset.name}",
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
      visible={isVisible}
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
            webKnossos Python API
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
