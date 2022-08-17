import { Form, Input, Button, Col, Radio, Row, Collapse } from "antd";
import { connect } from "react-redux";
import React, { useState } from "react";
import type { APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { exploreRemoteDataset, isDatasetNameValid, storeRemoteDataset } from "admin/admin_rest_api";
import messages from "messages";
import { jsonStringify } from "libs/utils";
import { CardContainer } from "admin/dataset/dataset_components";
import Password from "antd/lib/input/Password";
import TextArea from "antd/lib/input/TextArea";
import { AsyncButton } from "components/async_clickables";
import Toast from "libs/toast";
import _ from "lodash";
import { Hint } from "oxalis/view/action-bar/download_modal_view";
import { formatScale } from "libs/format_utils";
import { DataLayer, DatasourceConfiguration } from "types/schemas/datasource.types";
const { Panel } = Collapse;
const FormItem = Form.Item;
const RadioGroup = Radio.Group;

type OwnProps = {
  onAdded: (arg0: string, arg1: string) => Promise<void>;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
};
type Props = OwnProps & StateProps;

function ensureLargestSegmentIdsInPlace(datasource: DatasourceConfiguration) {
  for (const layer of datasource.dataLayers) {
    if (layer.category === "color" || layer.largestSegmentId == null) {
      continue;
    }
    layer.largestSegmentId = 1;
    Toast.warning(`Please adapt the largestSegmentID for layer ${layer.name}.`);
  }
}

function mergeNewLayers(
  loadedDatasource: DatasourceConfiguration,
  datasourceToMerge: DatasourceConfiguration,
): DatasourceConfiguration {
  const allLayers = datasourceToMerge.dataLayers.concat(loadedDatasource.dataLayers);
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
    ...loadedDatasource,
    dataLayers: uniqueLayers,
    id: {
      ...loadedDatasource.id,
      name: `${loadedDatasource.id.name}_and_${datasourceToMerge.id.name}`,
    },
  };
}

function DatasetAddZarrView(props: Props) {
  const { activeUser, onAdded } = props;
  const [datasourceConfig, setDatasourceConfig] = useState<string>("");
  const [exploreLog, setExploreLog] = useState<string>("");
  const [datasourceUrl, setDatasourceUrl] = useState<string>("");
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
    const { dataSource, report } =
      !usernameOrAccessKey || !passwordOrSecretKey
        ? await exploreRemoteDataset([datasourceUrl])
        : await exploreRemoteDataset([datasourceUrl], {
            username: usernameOrAccessKey,
            pass: passwordOrSecretKey,
          });
    setExploreLog(report);
    if (!dataSource) {
      Toast.error("Exploring this remote dataset did not return a datasource.");
      return;
    }
    ensureLargestSegmentIdsInPlace(dataSource);
    if (!datasourceConfig) {
      setDatasourceConfig(jsonStringify(dataSource));
      return;
    }
    let loadedDatasource;
    try {
      loadedDatasource = JSON.parse(datasourceConfig);
    } catch (e) {
      Toast.error(
        "The current datasource config contains invalid JSON. Cannot add the new Zarr data.",
      );
      return;
    }
    if (!_.isEqual(loadedDatasource.scale, dataSource.scale)) {
      Toast.warning(
        `${messages["dataset.add_zarr_different_scale_warning"]}\n${formatScale(dataSource.scale)}`,
        { timeout: 10000 },
      );
    }
    setDatasourceConfig(jsonStringify(mergeNewLayers(loadedDatasource, dataSource)));
  }

  async function handleStoreDataset() {
    if (datasourceConfig && activeUser) {
      let configJSON;
      try {
        configJSON = JSON.parse(datasourceConfig);
        const nameValidationResult = await isDatasetNameValid({
          name: configJSON.id.name,
          owningOrganization: activeUser.organization,
        });
        if (nameValidationResult) {
          throw new Error(nameValidationResult);
        }
        const response = await storeRemoteDataset(
          configJSON.id.name,
          activeUser.organization,
          datasourceConfig,
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

  return (
    // Using Forms here only to validate fields and for easy layout
    <div style={{ padding: 5 }}>
      <CardContainer title="Add Remote Zarr Dataset">
        Please enter a URL that points to the Zarr data you would like to import. If necessary,
        specify the credentials for the dataset. More layers can be added to the datasource
        specification below using the Add button. Once you have approved of the resulting datasource
        you can import it.
        <Form style={{ marginTop: 20 }} layout="vertical">
          <FormItem
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
            <Input
              defaultValue={datasourceUrl}
              onChange={(e) => setDatasourceUrl(e.target.value)}
            />
          </FormItem>
          <FormItem label="Authentication">
            <RadioGroup
              defaultValue="hide"
              value={showCredentialsFields ? "show" : "hide"}
              onChange={(e) => setShowCredentialsFields(e.target.value === "show")}
            >
              <Radio value="hide" disabled={selectedProtocol === "s3"}>
                {selectedProtocol === "https" ? "None" : "Anonymous"}
              </Radio>
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
          <FormItem style={{ marginBottom: 0 }}>
            <Row gutter={8}>
              <Col span={18} />
              <Col span={6}>
                <AsyncButton
                  size="large"
                  type={datasourceConfig ? "default" : "primary"}
                  style={{ width: "100%" }}
                  onClick={handleExplore}
                >
                  Add Layer
                </AsyncButton>
              </Col>
            </Row>
          </FormItem>
          <Collapse bordered={false} collapsible={exploreLog ? "header" : "disabled"}>
            <Panel header="Log" key="1">
              <Hint style={{ width: "90%" }}>
                <pre style={{ whiteSpace: "pre-wrap" }}>{exploreLog}</pre>
              </Hint>
            </Panel>
          </Collapse>
          <FormItem label="Datasource">
            <TextArea
              rows={4}
              autoSize={{ minRows: 3, maxRows: 15 }}
              style={{
                fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
              }}
              placeholder="No datasource loaded yet"
              value={datasourceConfig}
              onChange={(e) => setDatasourceConfig(e.target.value)}
            />
          </FormItem>
          <Row gutter={8}>
            <Col span={6} />
            <Col span={6} />
            <Col span={6}>
              <FormItem>
                <Button
                  size="large"
                  type="default"
                  style={{ width: "100%" }}
                  onClick={() => setDatasourceConfig("")}
                >
                  Reset
                </Button>
              </FormItem>
            </Col>
            <Col span={6}>
              <Button
                size="large"
                type="primary"
                style={{ width: "100%" }}
                onClick={handleStoreDataset}
                disabled={!datasourceConfig}
              >
                Import
              </Button>
            </Col>
          </Row>
        </Form>
      </CardContainer>
    </div>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(DatasetAddZarrView);
