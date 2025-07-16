import { exploreRemoteDataset } from "admin/rest_api";
import { Col, Collapse, Form, type FormInstance, Input, Radio, Row } from "antd";
import type { RcFile, UploadChangeParam, UploadFile } from "antd/lib/upload";
import { AsyncButton } from "components/async_clickables";
import { formatScale } from "libs/format_utils";
import { readFileAsText } from "libs/read_file";
import Toast from "libs/toast";
import { jsonStringify } from "libs/utils";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { useEffect, useState } from "react";
import type { APIDataStore } from "types/api_types";
import type { ArbitraryObject } from "types/globals";
import type { DataLayer, DatasourceConfiguration } from "types/schemas/datasource.types";
import { Hint } from "viewer/view/action-bar/download_modal_view";
import { GoogleAuthFormItem } from "./google_auth_form_item";

const FormItem = Form.Item;
const RadioGroup = Radio.Group;
const { Password } = Input;

type FileList = UploadFile<any>[];

function ensureLargestSegmentIdsInPlace(datasource: DatasourceConfiguration) {
  for (const layer of datasource.dataLayers) {
    if (layer.category === "color" || layer.largestSegmentId != null) {
      continue;
    }
    // Make sure the property exists. Otherwise, a field would not be
    // rendered in the form.
    layer.largestSegmentId = null;
  }
}

function mergeNewLayers(
  existingDatasource: DatasourceConfiguration | null,
  newDatasource: DatasourceConfiguration,
): DatasourceConfiguration {
  if (existingDatasource?.dataLayers == null) {
    return newDatasource;
  }
  const allLayers = newDatasource.dataLayers.concat(existingDatasource.dataLayers);
  const groupedLayers: Record<string, DataLayer[]> = _.groupBy(
    allLayers,
    (layer: DataLayer) => layer.name,
  );
  const uniqueLayers: DataLayer[] = [];
  for (const entry of _.entries(groupedLayers)) {
    const [name, layerGroup] = entry;
    if (layerGroup.length === 1) {
      uniqueLayers.push(layerGroup[0]);
    } else {
      let idx = 1;
      for (const layer of layerGroup) {
        if (idx === 1) {
          uniqueLayers.push(layer);
        } else {
          uniqueLayers.push({ ...layer, name: `${name}_${idx}` });
        }
        idx++;
      }
    }
  }
  return {
    ...existingDatasource,
    dataLayers: uniqueLayers,
  };
}

export const parseCredentials = async (
  file: RcFile | undefined,
): Promise<ArbitraryObject | null> => {
  if (!file) {
    return null;
  }
  const jsonString = await readFileAsText(file);
  try {
    return JSON.parse(jsonString);
  } catch (_exception) {
    Toast.error("Cannot parse credentials as valid JSON. Ignoring credentials file.");
    return null;
  }
};

export function AddRemoteLayer({
  form,
  uploadableDatastores,
  setDatasourceConfigStr,
  onSuccess,
  onError,
  defaultUrl,
}: {
  form: FormInstance;
  uploadableDatastores: APIDataStore[];
  setDatasourceConfigStr: (dataSourceJson: string) => void;
  onSuccess?: (datasetUrl: string) => Promise<void> | void;
  onError?: () => void;
  defaultUrl?: string | null | undefined;
}) {
  const isDatasourceConfigStrFalsy = Form.useWatch("dataSourceJson", form) != null;
  const datasourceUrl: string | null = Form.useWatch("url", form);
  const [exploreLog, setExploreLog] = useState<string | null>(null);
  const [showCredentialsFields, setShowCredentialsFields] = useState<boolean>(false);
  const [usernameOrAccessKey, setUsernameOrAccessKey] = useState<string>("");
  const [passwordOrSecretKey, setPasswordOrSecretKey] = useState<string>("");
  const [selectedProtocol, setSelectedProtocol] = useState<"s3" | "https" | "gs" | "file">("https");
  const [fileList, setFileList] = useState<FileList>([]);

  useEffect(() => {
    if (defaultUrl != null) {
      // only set datasourceUrl in the first render
      if (datasourceUrl == null) {
        form.setFieldValue("url", defaultUrl);
        form.validateFields(["url"]);
      } else {
        handleExplore();
      }
    }
  }, [defaultUrl, datasourceUrl, form.setFieldValue, form.validateFields]);

  const handleChange = (info: UploadChangeParam<UploadFile<any>>) => {
    // Restrict the upload list to the latest file
    const newFileList = info.fileList.slice(-1);
    setFileList(newFileList);
  };

  function validateUrls(userInput: string) {
    const removePrefix = (value: string, prefix: string) =>
      value.startsWith(prefix) ? value.slice(prefix.length) : value;

    // If pasted from neuroglancer, uris have these prefixes even before the protocol. The backend ignores them.
    userInput = removePrefix(userInput, "zarr://");
    userInput = removePrefix(userInput, "zarr3://");
    userInput = removePrefix(userInput, "n5://");
    userInput = removePrefix(userInput, "precomputed://");

    if (userInput.startsWith("https://") || userInput.startsWith("http://")) {
      setSelectedProtocol("https");
    } else if (userInput.startsWith("s3://")) {
      setSelectedProtocol("s3");
    } else if (userInput.startsWith("gs://")) {
      setSelectedProtocol("gs");
    } else if (userInput.startsWith("file://")) {
      setSelectedProtocol("file"); // Unused
    } else {
      throw new Error(
        "Dataset URL must employ one of the following protocols: https://, http://, s3://, gs:// or file://",
      );
    }
  }

  const handleFailure = () => {
    if (onError) onError();
  };

  async function handleExplore() {
    if (!datasourceUrl) {
      handleFailure();
      Toast.error("Please provide a valid URL for exploration.");
      return;
    }

    const datasourceConfigStr = form.getFieldValue("dataSourceJson");
    const datastoreToUse = uploadableDatastores.find(
      (datastore) => form.getFieldValue("datastoreUrl") === datastore.url,
    );
    if (!datastoreToUse) {
      handleFailure();
      Toast.error("Could not find datastore that allows uploading.");
      return;
    }

    const { dataSource: newDataSource, report } = await (async () => {
      // @ts-ignore
      const preferredVoxelSize = Utils.parseMaybe(datasourceConfigStr)?.scale;

      if (showCredentialsFields) {
        if (selectedProtocol === "gs") {
          const credentials =
            fileList.length > 0 ? await parseCredentials(fileList[0]?.originFileObj) : null;
          if (credentials) {
            return exploreRemoteDataset(
              [datasourceUrl],
              datastoreToUse.name,
              {
                username: "",
                pass: JSON.stringify(credentials),
              },
              preferredVoxelSize,
            );
          } else {
            // Fall through to exploreRemoteDataset without parameters
          }
        } else if (usernameOrAccessKey && passwordOrSecretKey) {
          return exploreRemoteDataset(
            [datasourceUrl],
            datastoreToUse.name,
            {
              username: usernameOrAccessKey,
              pass: passwordOrSecretKey,
            },
            preferredVoxelSize,
          );
        }
      }
      return exploreRemoteDataset([datasourceUrl], datastoreToUse.name, null, preferredVoxelSize);
    })();
    setExploreLog(report);
    if (!newDataSource) {
      handleFailure();
      Toast.error(
        "Exploring this remote dataset did not return a datasource. Please check the Log.",
      );
      return;
    }
    ensureLargestSegmentIdsInPlace(newDataSource);
    if (!datasourceConfigStr) {
      setDatasourceConfigStr(jsonStringify(newDataSource));
      if (onSuccess) {
        onSuccess(datasourceUrl);
      }
      return;
    }
    let existingDatasource: DatasourceConfiguration;
    try {
      existingDatasource = JSON.parse(datasourceConfigStr);
    } catch (_e) {
      handleFailure();
      Toast.error(
        "The current datasource config contains invalid JSON. Cannot add the new Zarr/N5 data.",
      );
      return;
    }
    if (
      existingDatasource?.scale != null &&
      !_.isEqual(existingDatasource.scale, newDataSource.scale)
    ) {
      Toast.warning(
        `${messages["dataset.add_zarr_different_scale_warning"]}\n${formatScale(
          newDataSource.scale,
        )}`,
        { timeout: 10000 },
      );
    }
    setDatasourceConfigStr(jsonStringify(mergeNewLayers(existingDatasource, newDataSource)));
    if (onSuccess) {
      onSuccess(datasourceUrl);
    }
  }

  return (
    <>
      Please enter a URL that points to the Zarr, Neuroglancer Precomputed or N5 data you would like
      to import. If necessary, specify the credentials for the dataset.{" "}
      {defaultUrl == null
        ? "For datasets with multiple \
        layers, e.g. raw microscopy and segmentation data, please add them separately with the ”Add \
        Layer” button below. Once you have approved of the resulting datasource you can import it."
        : "If the provided URL is valid, the datasource will be imported and you will be redirected to the dataset."}
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
            validator: (_rule, value) => {
              try {
                validateUrls(value);
                return Promise.resolve();
              } catch (e) {
                handleFailure();
                return Promise.reject(e);
              }
            },
          },
        ]}
        validateFirst
      >
        <Input />
      </FormItem>
      <FormItem label="Authentication">
        <RadioGroup
          defaultValue="hide"
          value={showCredentialsFields ? "show" : "hide"}
          onChange={(e) => setShowCredentialsFields(e.target.value === "show")}
        >
          <Radio value="hide">{selectedProtocol === "https" ? "None" : "Anonymous"}</Radio>
          <Radio value="show">
            {selectedProtocol === "https" ? "Basic authentication" : "With credentials"}
          </Radio>
        </RadioGroup>
      </FormItem>
      {showCredentialsFields ? (
        selectedProtocol === "gs" ? (
          <GoogleAuthFormItem fileList={fileList} handleChange={handleChange} />
        ) : (
          <Row gutter={8}>
            <Col span={12}>
              <FormItem
                label={selectedProtocol === "https" ? "Username" : "Access Key ID"}
                hasFeedback
                rules={[{ required: true }]}
                validateFirst
              >
                <Input
                  value={usernameOrAccessKey}
                  onChange={(e) => setUsernameOrAccessKey(e.target.value)}
                />
              </FormItem>
            </Col>
            <Col span={12}>
              <FormItem
                label={selectedProtocol === "https" ? "Password" : "Secret Access Key"}
                hasFeedback
                rules={[{ required: true }]}
                validateFirst
              >
                <Password
                  value={passwordOrSecretKey}
                  onChange={(e) => setPasswordOrSecretKey(e.target.value)}
                />
              </FormItem>
            </Col>
          </Row>
        )
      ) : null}
      {exploreLog ? (
        <Row gutter={8}>
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
      ) : null}
      <FormItem style={{ marginBottom: 0, marginTop: 20 }}>
        <Row gutter={8}>
          <Col span={18} />
          <Col span={6}>
            <AsyncButton
              size="large"
              type={isDatasourceConfigStrFalsy ? "primary" : "default"}
              style={{ width: "100%" }}
              onClick={handleExplore}
            >
              {defaultUrl == null ? "Add Layer" : "Validate URL and Continue"}
            </AsyncButton>
          </Col>
        </Row>
      </FormItem>
    </>
  );
}
