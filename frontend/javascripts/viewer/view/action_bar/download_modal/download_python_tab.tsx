import { getAuthToken } from "admin/rest_api";
import { Alert, Button, Divider, Flex, Typography } from "antd";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import messages from "messages";
import type { APIDataset } from "types/api_types";
import type { StoreAnnotation } from "viewer/store";
import { CopyableCodeSnippet } from "./download_shared";

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
  const contextUrlAddendum = nonDefaultHost ? `, url="${window.location.origin}"` : "";

  return `import webknossos as wk

with wk.webknossos_context(token="${authToken || "<insert token here>"}"${contextUrlAddendum}):
    # Get a reference to the dataset without downloading it. 
    # Image data will be streamed when being accessed.
    remote_dataset = wk.Dataset.open_remote(
        dataset_id="${dataset.id}",
    )
`;
}

export function DownloadPythonTab({ isAnnotation }: { isAnnotation: boolean }) {
  const annotation = useWkSelector((state) => state.annotation);
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);

  const { data: authToken } = useQueryWithErrorHandling({
    queryKey: ["authToken"],
    queryFn: getAuthToken,
    enabled: activeUser != null,
  });

  const typeName = isAnnotation ? "annotation" : "dataset";

  const wkInitSnippet = isAnnotation
    ? getPythonAnnotationDownloadSnippet(authToken ?? null, annotation)
    : getPythonDatasetDownloadSnippet(authToken ?? null, dataset);

  const alertTokenIsPrivate = () => {
    if (authToken) {
      Toast.warning(
        "The clipboard contains private data. Do not share this information with anyone you do not trust!",
      );
    }
  };

  return (
    <Flex vertical>
      <Typography.Paragraph>
        Use the{" "}
        <a href="https://docs.webknossos.org/webknossos-py/" target="_blank" rel="noopener noreferrer">
          WEBKNOSSOS Python API
        </a>{" "}
        to access this {typeName} in Python. Copy the snippets below into your project to get
        started.
      </Typography.Paragraph>
      <Divider>Code Snippets</Divider>
      <Typography.Text>
        <CopyableCodeSnippet code="pip install webknossos" />
        <CopyableCodeSnippet code={wkInitSnippet} onCopy={alertTokenIsPrivate} />
      </Typography.Text>
      <Alert
        type="warning"
        title={
          activeUser != null
            ? messages["download.python_do_not_share"]({ typeName })
            : messages["annotation.register_for_token"]
        }
      />
      <Divider />
      <Flex justify="end">
        <Button
          href="https://docs.webknossos.org/webknossos/data/export_ui.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn More
        </Button>
      </Flex>
    </Flex>
  );
}
