import { getAuthToken } from "admin/rest_api";
import { Divider, Row, Typography } from "antd";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import messages from "messages";
import type { APIDataset } from "types/api_types";
import type { StoreAnnotation } from "viewer/store";
import { CopyableCodeSnippet, MoreInfoHint } from "./download_info_shared";

function getPythonAnnotationDownloadSnippet(authToken: string | null, annotation: StoreAnnotation) {
  return `import webknossos as wk

with wk.webknossos_context(
    token="${authToken || "<insert token here>"}",
    url="${window.location.origin}"
):
    annotation = wk.Annotation.download("${annotation.annotationId}")
`;
}

function getPythonDatasetDownloadSnippet(authToken: string | null, dataset: APIDataset) {
  const nonDefaultHost = !document.location.host.endsWith("webknossos.org");
  const indentation = "\n        ";
  const contextUrlAddendum = nonDefaultHost ? `, url="${window.location.origin}"` : "";
  const maybeUrlParameter = nonDefaultHost
    ? `${indentation}webknossos_url="${window.location.origin}"`
    : "";

  return `import webknossos as wk

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
}

export function DownloadPythonTab({ isAnnotation }: { isAnnotation: boolean }) {
  const annotation = useWkSelector((state) => state.annotation);
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);

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

  const typeName = isAnnotation ? "annotation" : "dataset";

  const wkInitSnippet = isAnnotation
    ? getPythonAnnotationDownloadSnippet(authToken, annotation)
    : getPythonDatasetDownloadSnippet(authToken, dataset);

  const alertTokenIsPrivate = () => {
    if (authToken) {
      Toast.warning(
        "The clipboard contains private data. Do not share this information with anyone you do not trust!",
      );
    }
  };

  const maybeShowWarning = () => {
    return (
      <Row key="python-token-warning">
        <Typography.Text
          style={{
            margin: "0 6px 12px",
          }}
          type="warning"
        >
          {activeUser != null
            ? messages["download.python_do_not_share"]({ typeName })
            : messages["annotation.register_for_token"]}
        </Typography.Text>
      </Row>
    );
  };

  return (
    <>
      <Row>
        <Typography.Text
          style={{
            margin: "0 6px 12px",
          }}
        >
          The following code snippets are suggestions to get you started quickly with the{" "}
          <a href="https://docs.webknossos.org/webknossos-py/" target="_blank" rel="noreferrer">
            WEBKNOSSOS Python API
          </a>
          . To download and use this {typeName} in your Python project, simply copy and paste the
          code snippets to your script.
        </Typography.Text>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Code Snippets
      </Divider>
      {maybeShowWarning()}
      <Typography.Paragraph>
        <CopyableCodeSnippet code="pip install webknossos" />
        <CopyableCodeSnippet code={wkInitSnippet} onCopy={alertTokenIsPrivate} />
      </Typography.Paragraph>
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      <MoreInfoHint />
    </>
  );
}
