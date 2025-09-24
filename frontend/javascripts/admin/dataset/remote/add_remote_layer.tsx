import { exploreRemoteDataset } from "admin/rest_api";
import { Col, Collapse, Form, type FormInstance, Input, Radio, Row } from "antd";
import type { RcFile, UploadChangeParam, UploadFile } from "antd/lib/upload";
import { AsyncButton } from "components/async_clickables";
import { readFileAsText } from "libs/read_file";
import Toast from "libs/toast";
import messages from "messages";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { APIDataStore, VoxelSize } from "types/api_types";
import type { ArbitraryObject } from "types/globals";
import type { DatasourceConfiguration } from "types/schemas/datasource.types";
import { Hint } from "viewer/view/action-bar/download_modal_view";
import { GoogleAuthFormItem } from "./google_auth_form_item";
import { isEqual } from "lodash";
import { formatScale } from "libs/format_utils";

const FormItem = Form.Item;
const RadioGroup = Radio.Group;
const { Password } = Input;

type FileList = UploadFile<any>[];
type Protocol = "s3" | "https" | "gs" | "file";

interface AddRemoteLayerProps {
  form: FormInstance;
  uploadableDatastores: APIDataStore[];
  onSuccess?: (
    datasetUrl: string,
    newDataSourceConfig: DatasourceConfiguration,
  ) => Promise<void> | void;
  onError?: () => void;
  defaultUrl?: string | null | undefined;
  preferredVoxelSize?: VoxelSize;
}

// Constants
const SUPPORTED_PROTOCOLS: Protocol[] = ["https", "s3", "gs", "file"];
const NEUROGLANCER_PREFIXES = ["zarr://", "zarr3://", "n5://", "precomputed://"];

// Utility functions
const removePrefix = (value: string, prefix: string): string =>
  value.startsWith(prefix) ? value.slice(prefix.length) : value;

const removePrefixes = (input: string, prefixes: string[]): string =>
  prefixes.reduce((result, prefix) => removePrefix(result, prefix), input);

const detectProtocol = (url: string): Protocol => {
  const cleanUrl = removePrefixes(url, NEUROGLANCER_PREFIXES);

  if (cleanUrl.startsWith("https://") || cleanUrl.startsWith("http://")) {
    return "https";
  }
  if (cleanUrl.startsWith("s3://")) {
    return "s3";
  }
  if (cleanUrl.startsWith("gs://")) {
    return "gs";
  }
  if (cleanUrl.startsWith("file://")) {
    return "file";
  }

  throw new Error(
    `Dataset URL must employ one of the following protocols: ${SUPPORTED_PROTOCOLS.map((p) => `${p}://`).join(", ")}`,
  );
};

const ensureLargestSegmentIdsInPlace = (datasource: DatasourceConfiguration): void => {
  for (const layer of datasource.dataLayers) {
    if (layer.category === "color" || layer.largestSegmentId != null) {
      continue;
    }
    // Make sure the property exists. Otherwise, a field would not be
    // rendered in the form.
    layer.largestSegmentId = null;
  }
};

const parseCredentials = async (file: RcFile | undefined): Promise<ArbitraryObject | null> => {
  if (!file) {
    return null;
  }

  try {
    const jsonString = await readFileAsText(file);
    return JSON.parse(jsonString);
  } catch (_exception) {
    Toast.error("Cannot parse credentials as valid JSON. Ignoring credentials file.");
    return null;
  }
};

export const AddRemoteLayer: React.FC<AddRemoteLayerProps> = ({
  form,
  uploadableDatastores,
  onSuccess,
  onError,
  defaultUrl,
  preferredVoxelSize,
}) => {
  const datasourceUrl: string | null = Form.useWatch("url", form);

  // State
  const [exploreLog, setExploreLog] = useState<string | null>(null);
  const [showCredentialsFields, setShowCredentialsFields] = useState<boolean>(false);
  const [usernameOrAccessKey, setUsernameOrAccessKey] = useState<string>("");
  const [passwordOrSecretKey, setPasswordOrSecretKey] = useState<string>("");
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol>("https");
  const [fileList, setFileList] = useState<FileList>([]);
  const [isExploring, setIsExploring] = useState<boolean>(false);

  // Memoized values
  const authLabel = useMemo(
    () => ({
      none: selectedProtocol === "https" ? "None" : "Anonymous",
      show: selectedProtocol === "https" ? "Basic authentication" : "With credentials",
      username: selectedProtocol === "https" ? "Username" : "Access Key ID",
      password: selectedProtocol === "https" ? "Password" : "Secret Access Key",
    }),
    [selectedProtocol],
  );

  const instructionText = useMemo(() => {
    const baseText =
      "Please enter a URL that points to the Zarr, Neuroglancer Precomputed or N5 data you would like to import. If necessary, specify the credentials for the dataset.";

    if (defaultUrl == null) {
      return `${baseText} For datasets with multiple layers, e.g. raw microscopy and segmentation data, please add them separately with the "Add Layer" button below. Once you have approved of the resulting datasource you can import it.`;
    }

    return `${baseText} If the provided URL is valid, the datasource will be imported and you will be redirected to the dataset.`;
  }, [defaultUrl]);

  // Handlers
  const handleFailure = useCallback(() => {
    setIsExploring(false);
    onError?.();
  }, [onError]);

  const handleFileChange = useCallback((info: UploadChangeParam<UploadFile<any>>) => {
    // Restrict the upload list to the latest file
    setFileList(info.fileList.slice(-1));
  }, []);

  const validateUrl = useCallback(
    (_rule: any, value: string) => {
      try {
        const protocol = detectProtocol(value);
        setSelectedProtocol(protocol);
        return Promise.resolve();
      } catch (error) {
        handleFailure();
        return Promise.reject(error);
      }
    },
    [handleFailure],
  );

  const buildExploreParams = useCallback(async () => {
    if (!datasourceUrl) {
      throw new Error("Please provide a valid URL for exploration.");
    }

    const datastoreToUse = uploadableDatastores.find(
      (datastore) => form.getFieldValue("datastoreUrl") === datastore.url,
    );

    if (!datastoreToUse) {
      throw new Error("Could not find datastore that allows uploading.");
    }

    let credentials = null;

    if (showCredentialsFields) {
      if (selectedProtocol === "gs") {
        const parsedCredentials =
          fileList.length > 0 ? await parseCredentials(fileList[0]?.originFileObj) : null;

        if (parsedCredentials) {
          credentials = {
            username: "",
            pass: JSON.stringify(parsedCredentials),
          };
        }
      } else if (usernameOrAccessKey && passwordOrSecretKey) {
        credentials = {
          username: usernameOrAccessKey,
          pass: passwordOrSecretKey,
        };
      }
    }

    return {
      url: datasourceUrl,
      datastoreName: datastoreToUse.name,
      credentials,
      preferredVoxelSize,
    };
  }, [
    datasourceUrl,
    uploadableDatastores,
    form,
    showCredentialsFields,
    selectedProtocol,
    fileList,
    usernameOrAccessKey,
    passwordOrSecretKey,
    preferredVoxelSize,
  ]);

  const handleExplore = useCallback(async () => {
    if (isExploring) return;

    setIsExploring(true);
    setExploreLog(null);

    try {
      const { url, datastoreName, credentials, preferredVoxelSize } = await buildExploreParams();

      const { dataSource: newDataSourceConfig, report } = await exploreRemoteDataset(
        [url],
        datastoreName,
        credentials,
        preferredVoxelSize?.factor,
      );

      setExploreLog(report);

      if (!newDataSourceConfig) {
        throw new Error(
          "Exploring this remote dataset did not return a datasource. Please check the Log.",
        );
      }

      ensureLargestSegmentIdsInPlace(newDataSourceConfig);

      // Check for scale differences
      if (preferredVoxelSize?.factor && !isEqual(preferredVoxelSize, newDataSourceConfig.scale)) {
        Toast.warning(
          `${messages["dataset.add_zarr_different_scale_warning"]}\n${formatScale(
            newDataSourceConfig.scale,
          )}`,
          { timeout: 10000 },
        );
      }

      await onSuccess?.(url, newDataSourceConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
      Toast.error(errorMessage);
      handleFailure();
    } finally {
      setIsExploring(false);
    }
  }, [isExploring, buildExploreParams, onSuccess, handleFailure]);

  // Effects
  useEffect(() => {
    if (defaultUrl != null && datasourceUrl == null) {
      form.setFieldValue("url", defaultUrl);
      form.validateFields(["url"]);
    } else if (defaultUrl != null && datasourceUrl != null) {
      handleExplore();
    }
  }, [defaultUrl, datasourceUrl, form, handleExplore]);

  // Reset credentials when protocol changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: We explicitly want to reset the credentials when the protocol changes
  useEffect(() => {
    setUsernameOrAccessKey("");
    setPasswordOrSecretKey("");
    setFileList([]);
  }, [selectedProtocol]);

  return (
    <>
      <p style={{ marginBottom: 16 }}>{instructionText}</p>

      <FormItem
        style={{ marginTop: 16, marginBottom: 16 }}
        name="url"
        label="Dataset URL"
        tooltip="Supported protocols are HTTPS, Amazon S3 and Google Cloud Storage"
        hasFeedback
        rules={[
          {
            required: true,
            message: messages["dataset.import.required.url"],
          },
          {
            validator: validateUrl,
          },
        ]}
        validateFirst
      >
        <Input placeholder="Enter dataset URL..." />
      </FormItem>

      <FormItem label="Authentication">
        <RadioGroup
          value={showCredentialsFields ? "show" : "hide"}
          onChange={(e) => setShowCredentialsFields(e.target.value === "show")}
        >
          <Radio value="hide">{authLabel.none}</Radio>
          <Radio value="show">{authLabel.show}</Radio>
        </RadioGroup>
      </FormItem>

      {showCredentialsFields && (
        <>
          {selectedProtocol === "gs" ? (
            <GoogleAuthFormItem fileList={fileList} handleChange={handleFileChange} />
          ) : (
            <Row gutter={8}>
              <Col span={12}>
                <FormItem
                  label={authLabel.username}
                  hasFeedback
                  rules={[{ required: true, message: `${authLabel.username} is required` }]}
                  validateFirst
                >
                  <Input
                    value={usernameOrAccessKey}
                    onChange={(e) => setUsernameOrAccessKey(e.target.value)}
                    placeholder={`Enter ${authLabel.username.toLowerCase()}`}
                  />
                </FormItem>
              </Col>
              <Col span={12}>
                <FormItem
                  label={authLabel.password}
                  hasFeedback
                  rules={[{ required: true, message: `${authLabel.password} is required` }]}
                  validateFirst
                >
                  <Password
                    value={passwordOrSecretKey}
                    onChange={(e) => setPasswordOrSecretKey(e.target.value)}
                    placeholder={`Enter ${authLabel.password.toLowerCase()}`}
                  />
                </FormItem>
              </Col>
            </Row>
          )}
        </>
      )}

      {exploreLog && (
        <Row gutter={8} style={{ marginTop: 16 }}>
          <Col span={24}>
            <Collapse
              defaultActiveKey="1"
              items={[
                {
                  key: "1",
                  label: "Error Log",
                  children: (
                    <Hint style={{ width: "90%" }}>
                      <pre style={{ whiteSpace: "pre-wrap" }}>{exploreLog}</pre>
                    </Hint>
                  ),
                },
              ]}
            />
          </Col>
        </Row>
      )}

      <FormItem style={{ marginBottom: 0, marginTop: 20 }}>
        <Row gutter={8}>
          <Col span={18} />
          <Col span={6}>
            <AsyncButton
              size="large"
              type="primary"
              style={{ width: "100%" }}
              onClick={handleExplore}
              loading={isExploring}
              disabled={!datasourceUrl || isExploring}
            >
              {defaultUrl == null ? "Add Layer" : "Validate URL and Continue"}
            </AsyncButton>
          </Col>
        </Row>
      </FormItem>
    </>
  );
};
