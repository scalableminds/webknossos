import { Form, Input, Button, Col, Row, Collapse } from "antd";
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
import DataLayer from "oxalis/model/data_layer";
import _ from "lodash";
import { Hint } from "oxalis/view/action-bar/download_modal_view";
const { Panel } = Collapse;
const FormItem = Form.Item;

type OwnProps = {
  onAdded: (arg0: string, arg1: string) => Promise<void>;
};
type StateProps = {
  activeUser: APIUser | null | undefined;
};
type Props = OwnProps & StateProps;

function DatasetAddZarrView(props: Props) {
  const { activeUser, onAdded } = props;
  const [datasourceConfig, setDatasourceConfig] = useState<string>("");
  const [exploreLog, setExploreLog] = useState<string>("");
  const [datasourceUrl, setDatasourceUrl] = useState<string>("");
  const [usernameOrAccessKey, setUsernameOrAccessKey] = useState<string>("");
  const [passwordOrSecretKey, setPasswordOrSecretKey] = useState<string>("");
  const [selectedProtocol, setSelectedProtocol] = useState<"s3" | "https">("https");

  function validateUrls(userInput: string) {
    if (
      (userInput.indexOf("https://") === 0 && userInput.indexOf("s3://") !== 0) ||
      (userInput.indexOf("https://") !== 0 && userInput.indexOf("s3://") === 0)
    ) {
      setSelectedProtocol(userInput.indexOf("https://") === 0 ? "https" : "s3");
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
        `${messages["dataset.add_zarr_different_scale_warning"]}\n${dataSource.scale.join("\n")}`,
      );
    }
    const layers = loadedDatasource.dataLayers.concat(dataSource.dataLayers);
    const uniqueLayers = _.uniqBy(layers, (layer: DataLayer) => layer.name);
    loadedDatasource.dataLayers = uniqueLayers;
    loadedDatasource.id.name = `${loadedDatasource.id.name}_and_${dataSource.id.name}`;
    setDatasourceConfig(jsonStringify(loadedDatasource));
  }

  async function handleStoreDataset() {
    if (datasourceConfig && activeUser) {
      let configJSON;
      try {
        configJSON = JSON.parse(datasourceConfig);
        const nameValidationResult = await isDatasetNameValid(configJSON.id);
        if (nameValidationResult) {
          throw new Error(nameValidationResult);
        }
        const response = await storeRemoteDataset(
          configJSON.id.name,
          activeUser.organization,
          datasourceConfig,
        );
        if (response.status !== 200) {
          throw new Error(`${response.status} ${response.statusText} ${response.json}`);
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
      <CardContainer title="Add Zarr Dataset">
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
          <Row gutter={8}>
            <Col span={12}>
              <FormItem label={selectedProtocol === "https" ? "Username" : "Access Key"}>
                <Input
                  value={usernameOrAccessKey}
                  onChange={(e) => setUsernameOrAccessKey(e.target.value)}
                />
              </FormItem>
            </Col>
            <Col span={12}>
              <FormItem label={selectedProtocol === "https" ? "Password" : "Secret Key"}>
                <Password
                  value={passwordOrSecretKey}
                  onChange={(e) => setPasswordOrSecretKey(e.target.value)}
                />
              </FormItem>
            </Col>
          </Row>
          <FormItem style={{ marginBottom: 0 }}>
            <AsyncButton
              size="large"
              type="default"
              style={{ width: "100%" }}
              onClick={handleExplore}
            >
              Add
            </AsyncButton>
          </FormItem>
          <Collapse bordered={false} collapsible={exploreLog ? "header" : "disabled"}>
            <Panel header="Exploration Log" key="1">
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
            <Col span={12}>
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
            <Col span={12}>
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
