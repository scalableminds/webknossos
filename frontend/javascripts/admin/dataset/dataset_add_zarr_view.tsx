import { Form, Input, Button, Col, Radio, Row, Collapse, FormInstance, Modal, Divider } from "antd";
import { connect } from "react-redux";
import React, { useState } from "react";
import type { APIDataStore, APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { exploreRemoteDataset, isDatasetNameValid, storeRemoteDataset } from "admin/admin_rest_api";
import messages from "messages";
import { jsonStringify } from "libs/utils";
import { CardContainer } from "admin/dataset/dataset_components";
import Password from "antd/lib/input/Password";
import { AsyncButton } from "components/async_clickables";
import Toast from "libs/toast";
import _ from "lodash";
import { Hint } from "oxalis/view/action-bar/download_modal_view";
import { formatScale } from "libs/format_utils";
import { DataLayer, DatasourceConfiguration } from "types/schemas/datasource.types";
import DatasetSettingsDataTab, {
  // Sync simple with advanced and get newest datasourceJson
  syncDataSourceFields,
} from "dashboard/dataset/dataset_settings_data_tab";
import { Hideable } from "dashboard/dataset/helper_components";
const { Panel } = Collapse;
const FormItem = Form.Item;
const RadioGroup = Radio.Group;

type OwnProps = {
  onAdded: (arg0: string, arg1: string) => Promise<void>;
  datastores: Array<APIDataStore>;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
};
type Props = OwnProps & StateProps;

function ensureLargestSegmentIdsInPlace(datasource: DatasourceConfiguration) {
  for (const layer of datasource.dataLayers) {
    if (layer.category === "color" || layer.largestSegmentId != null) {
      continue;
    }
    // Make sure the property exists. Otherwise, the field would not be
    // rendered in the form.
    layer.largestSegmentId = null;
  }
}

function mergeNewLayers(
  existingDatasource: DatasourceConfiguration | null,
  newDatasource: DatasourceConfiguration,
): DatasourceConfiguration {
  if (existingDatasource == null) {
    return newDatasource;
  }
  const allLayers = newDatasource.dataLayers.concat(existingDatasource.dataLayers);
  const groupedLayers = _.groupBy(allLayers, (layer: DataLayer) => layer.name) as unknown as Record<
    string,
    DataLayer[]
  >;
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

function DatasetAddZarrView(props: Props) {
  const { activeUser, onAdded } = props;

  const [showAddLayerModal, setShowAddLayerModal] = useState(false);
  const [dataSourceEditMode, setDataSourceEditMode] = useState<"simple" | "advanced">("simple");
  const [form] = Form.useForm();
  const isDatasourceConfigStrFalsy = !Form.useWatch("dataSourceJson", form);
  const maybeDataLayers = Form.useWatch(["dataSource", "dataLayers"], form);

  const setDatasourceConfigStr = (dataSourceJson: string) => {
    form.setFieldsValue({ dataSourceJson });
    // Since this function sets the JSON string, we have to update the
    // data which is rendered by the "simple" page.
    syncDataSourceFields(form, "simple");
    form.validateFields();
  };

  async function handleStoreDataset() {
    // Sync simple with advanced and get newest datasourceJson
    syncDataSourceFields(form, dataSourceEditMode === "simple" ? "advanced" : "simple");
    await form.validateFields();
    const datasourceConfigStr = form.getFieldValue("dataSourceJson");

    const uploadableDatastores = props.datastores.filter((datastore) => datastore.allowsUpload);
    const datastoreToUse = uploadableDatastores[0];
    if (!datastoreToUse) {
      Toast.error("Could not find datastore that allows uploading.");
      return;
    }

    if (datasourceConfigStr && activeUser) {
      let configJSON;
      try {
        configJSON = JSON.parse(datasourceConfigStr);
        const nameValidationResult = await isDatasetNameValid({
          name: configJSON.id.name,
          owningOrganization: activeUser.organization,
        });
        if (nameValidationResult) {
          throw new Error(nameValidationResult);
        }
        const response = await storeRemoteDataset(
          datastoreToUse.url,
          configJSON.id.name,
          activeUser.organization,
          datasourceConfigStr,
        );
        if (response.status !== 200) {
          const errorJSONString = JSON.stringify(await response.json());
          throw new Error(`${response.status} ${response.statusText} ${errorJSONString}`);
        }
      } catch (e) {
        Toast.error(`The datasource config could not be stored. ${e}`);
        return;
      }
      onAdded(activeUser.organization, configJSON.id.name);
    }
  }

  const hideDatasetUI = maybeDataLayers == null || maybeDataLayers.length === 0;
  return (
    // Using Forms here only to validate fields and for easy layout
    <div style={{ padding: 5 }}>
      <CardContainer title="Add Remote Zarr / N5 Dataset">
        <Form form={form} layout="vertical">
          <Modal
            title="Add Layer"
            width={800}
            visible={showAddLayerModal}
            footer={null}
            onCancel={() => setShowAddLayerModal(false)}
          >
            <AddZarrLayer
              form={form}
              setDatasourceConfigStr={setDatasourceConfigStr}
              onSuccess={() => setShowAddLayerModal(false)}
              dataSourceEditMode={dataSourceEditMode}
            />
          </Modal>

          {hideDatasetUI && (
            <AddZarrLayer
              form={form}
              setDatasourceConfigStr={setDatasourceConfigStr}
              dataSourceEditMode={dataSourceEditMode}
            />
          )}
          <Hideable hidden={hideDatasetUI}>
            {/* Only the component's visibility is changed, so that the form is always rendered.
                This is necessary so that the form's structure is always populated. */}
            <DatasetSettingsDataTab
              isEditingMode={false}
              isReadOnlyDataset={false}
              form={form}
              activeDataSourceEditMode={dataSourceEditMode}
              onChange={(activeEditMode) => {
                syncDataSourceFields(form, activeEditMode);
                form.validateFields();
                setDataSourceEditMode(activeEditMode);
              }}
            />
          </Hideable>
          {!hideDatasetUI && (
            <>
              <Divider />
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
                <Button type="link" onClick={() => setShowAddLayerModal(true)}>
                  Add Layer
                </Button>
              </div>
              <Row gutter={8}>
                <Col span={12} />
                <Col span={6}>
                  <FormItem>
                    <Button
                      size="large"
                      type="default"
                      style={{ width: "100%" }}
                      onClick={() => setDatasourceConfigStr("")}
                    >
                      Reset
                    </Button>
                  </FormItem>
                </Col>
                <Col span={6}>
                  <Form.Item shouldUpdate>
                    {() => (
                      <Button
                        size="large"
                        type="primary"
                        style={{ width: "100%" }}
                        onClick={handleStoreDataset}
                        disabled={
                          isDatasourceConfigStrFalsy ||
                          !!form.getFieldsError().filter(({ errors }) => errors.length).length
                        }
                      >
                        Import
                      </Button>
                    )}
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
        </Form>
      </CardContainer>
    </div>
  );
}

function AddZarrLayer({
  form,
  setDatasourceConfigStr,
  onSuccess,
  dataSourceEditMode,
}: {
  form: FormInstance;
  setDatasourceConfigStr: (dataSourceJson: string) => void;
  onSuccess?: () => void;
  dataSourceEditMode: "simple" | "advanced";
}) {
  const isDatasourceConfigStrFalsy = !Form.useWatch("dataSourceJson", form);
  const datasourceUrl: string | null = Form.useWatch("url", form);
  const [exploreLog, setExploreLog] = useState<string | null>(null);
  const [showCredentialsFields, setShowCredentialsFields] = useState<boolean>(false);
  const [usernameOrAccessKey, setUsernameOrAccessKey] = useState<string>("");
  const [passwordOrSecretKey, setPasswordOrSecretKey] = useState<string>("");
  const [selectedProtocol, setSelectedProtocol] = useState<"s3" | "https">("https");

  function validateUrls(userInput: string) {
    if (
      (userInput.indexOf("https://") === 0 && userInput.indexOf("s3://") !== 0) ||
      (userInput.indexOf("https://") !== 0 && userInput.indexOf("s3://") === 0)
    ) {
      setSelectedProtocol(userInput.indexOf("https://") === 0 ? "https" : "s3");
      setShowCredentialsFields(userInput.indexOf("s3://") === 0);
    } else {
      throw new Error("Dataset URL must employ either the https:// or s3:// protocol.");
    }
  }

  async function handleExplore() {
    if (!datasourceUrl) {
      Toast.error("Please provide a valid URL for exploration.");
      return;
    }

    // Sync simple with advanced and get newest datasourceJson
    syncDataSourceFields(form, dataSourceEditMode === "simple" ? "advanced" : "simple");
    const datasourceConfigStr = form.getFieldValue("dataSourceJson");

    const { dataSource: newDataSource, report } =
      !usernameOrAccessKey || !passwordOrSecretKey
        ? await exploreRemoteDataset([datasourceUrl])
        : await exploreRemoteDataset([datasourceUrl], {
            username: usernameOrAccessKey,
            pass: passwordOrSecretKey,
          });
    setExploreLog(report);
    if (!newDataSource) {
      Toast.error(
        "Exploring this remote dataset did not return a datasource. Please check the Log.",
      );
      return;
    }
    ensureLargestSegmentIdsInPlace(newDataSource);
    if (!datasourceConfigStr) {
      setDatasourceConfigStr(jsonStringify(newDataSource));
      return;
    }
    let existingDatasource;
    try {
      existingDatasource = JSON.parse(datasourceConfigStr);
    } catch (e) {
      Toast.error(
        "The current datasource config contains invalid JSON. Cannot add the new Zarr/N5 data.",
      );
      return;
    }
    if (existingDatasource != null && !_.isEqual(existingDatasource.scale, newDataSource.scale)) {
      Toast.warning(
        `${messages["dataset.add_zarr_different_scale_warning"]}\n${formatScale(
          newDataSource.scale,
        )}`,
        { timeout: 10000 },
      );
    }
    setDatasourceConfigStr(jsonStringify(mergeNewLayers(existingDatasource, newDataSource)));
    if (onSuccess) {
      onSuccess();
    }
  }

  return (
    <>
      Please enter a URL that points to the Zarr or N5 data you would like to import. If necessary,
      specify the credentials for the dataset. For datasets with multiple layers, e.g. raw
      microscopy and segmentattion data, please add them separately with the ”Add Layer” button
      below. Once you have approved of the resulting datasource you can import it.
      <FormItem
        style={{ marginTop: 16 }}
        name="url"
        label="Dataset URL"
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
      ) : null}
      {exploreLog ? (
        <Row gutter={8}>
          <Col span={24}>
            <Collapse defaultActiveKey="1">
              <Panel header="Error Log" key="1">
                <Hint style={{ width: "90%" }}>
                  <pre style={{ whiteSpace: "pre-wrap" }}>{exploreLog}</pre>
                </Hint>
              </Panel>
            </Collapse>
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
              Add Layer
            </AsyncButton>
          </Col>
        </Row>
      </FormItem>
    </>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(DatasetAddZarrView);
