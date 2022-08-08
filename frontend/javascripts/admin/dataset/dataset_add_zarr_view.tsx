import { Form, Input, Button, Col, Row, Divider, } from "antd";
import { connect } from "react-redux";
import React, { useState } from "react";
import type { APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { exploreRemoteDataset, putDataset } from "admin/admin_rest_api";
import messages from "messages";
import Toast from "libs/toast";
import { jsonStringify } from "libs/utils";
import { CardContainer } from "admin/dataset/dataset_components";
import Password from "antd/lib/input/Password";
import TextArea from "antd/lib/input/TextArea";
import { AsyncButton } from "components/async_clickables";
import { DatasourceConfiguration } from "types/schemas/datasource.types";
// import { isDatasourceJSONValid } from "types/validation";
const FormItem = Form.Item;
// const Option = Select.Option;
type Props = {
  activeUser: APIUser | null | undefined;
};

function DatasetAddZarrView({ activeUser }: Props) {
  const [datasourceConfig, setDatasourceConfig] = useState<string>("init");
  // const [exploreLog, setExploreLog] = useState<string>();
  const [datasetUrl, setDatasetUrl] = useState<string>(
    "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0047A/4496763.zarr",
  );
  // const [selectedProtocol, setSelectedProtocol] = useState<string>("https://");
  const [canTryToMergeData, setCanTryToMergeData] = useState<boolean>(false);

  async function validateAndParseUrl(url: string) {
    // TODO: handle multiple urls
    if (url) {
      if (url.indexOf("https://") === -1 && url.indexOf("s3://") === -1) {
        throw new Error("No valid protocol.");
      }
      const result = jsonStringify(await exploreRemoteDataset([datasetUrl]));
      // TODO: isDatasourceJSONValid
      if (datasourceConfig === "init") {
        setDatasourceConfig(result);
      }
      if (result !== datasourceConfig) {
        setCanTryToMergeData(!!result);
      }
    }
  }

  function mergeNewDataLayers(maybeNewDataLayers: DatasourceConfiguration) {
    if (datasourceConfig) {
      try {
        const mergedDatasource = JSON.parse(datasourceConfig);
        for (const layer of maybeNewDataLayers.dataLayers) {
          mergedDatasource[layer.name] = layer;
        }
        setDatasourceConfig(mergedDatasource);
      } catch (error) {
        Toast.error("Invalid data source description.");
      }
    } else {
      setDatasourceConfig(jsonStringify(maybeNewDataLayers));
    }
  }

  async function handleExplore() {
    if (datasetUrl) {
      const result = await exploreRemoteDataset([datasetUrl]);
      mergeNewDataLayers(result);
    } else {
      Toast.error("Please enter a valid dataset URL to explore.");
    }
  }

  async function handleAddDataset() {
    if (datasourceConfig && activeUser) {
      await putDataset(
        JSON.parse(datasourceConfig).id.name,
        activeUser.organization,
        datasourceConfig,
      );
    }
  }

  // const selectBefore = (
  //   <Select
  //     value={selectedProtocol}
  //     style={{ width: 100 }}
  //     onChange={(value) => setSelectedProtocol(value)}
  //   >
  //     <Option value="https://">https://</Option>
  //     <Option value="s3://">s3://</Option>
  //   </Select>
  // );
  return (
    // Using Forms here only to validate fields and for easy layout
    <div style={{ padding: 5 }}>
      <CardContainer title="Add Zarr Dataset">
        Please enter a URL to identify the kind of Zarr data you would like to import (layer or
        dataset). Detected datasets can be imported right away. In case of a layer being detected
        you can add it to the dataset before the final import.
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
                validator: (_rule, url) => {
                  try {
                    validateAndParseUrl(url);
                    return Promise.resolve();
                  } catch (error) {
                    return Promise.reject(error);
                  }
                },
              },
            ]}
            validateFirst
          >
            <Input
              // addonBefore={selectBefore}
              defaultValue={datasetUrl}
              onChange={(e) => {
                // if (e.target.value.indexOf("https://") === 0) {
                //   setSelectedProtocol("https://");
                // } else if (e.target.value.indexOf("s3://") === 0) {
                //   setSelectedProtocol("s3://");
                // }
                setDatasetUrl(e.target.value);
              }
            }
            />
          </FormItem>
          {canTryToMergeData && datasourceConfig
              ? "Detected a new datasource. Would you like to try and merge this data with the present datasource?"
              : null}
          <Row gutter={8}>
            <Col span={12}>
              <FormItem
                name="username"
                label="Username"
                // label={selectedProtocol === "https://" ? "Username" : "Access Key"}
                hasFeedback
                rules={[{ required: true }]}
                validateFirst
              >
                <Input />
              </FormItem>
            </Col>
            <Col span={12}>
              <FormItem
                name="password"
                label="Password"
                // label={selectedProtocol === "https://" ? "Password" : "Secret Key"}
                hasFeedback
                rules={[{ required: true }]}
                validateFirst
              >
                <Password />
              </FormItem>
            </Col>
          </Row>
          <FormItem style={{ marginBottom: 0 }}>
            <AsyncButton
              size="large"
              type="primary"
              style={{ width: "100%" }}
              onClick={handleExplore}
              disabled={!canTryToMergeData}
            >
              Add
            </AsyncButton>
          </FormItem>
          <Divider />
          {datasourceConfig !== "init" ? (
            <div>
              <Row gutter={8}>
                <Col span={12}>
                  <FormItem>
                    <Button size="large" type="default" style={{ width: "100%" }}>
                      Cancel
                    </Button>
                  </FormItem>
                </Col>
                <Col span={12}>
                  <Button
                    size="large"
                    type="primary"
                    style={{ width: "100%" }}
                    onClick={handleAddDataset}
                  >
                    Import
                  </Button>
                </Col>
              </Row>
              <FormItem>
                <TextArea
                  rows={4}
                  autoSize={{ minRows: 4, maxRows: 25 }}
                  style={{
                    fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
                  }}
                  value={datasourceConfig}
                />
              </FormItem>
            </div>
          ) : null}
        </Form>
      </CardContainer>
    </div>
  );
}

const mapStateToProps = (state: OxalisState): Props => ({
  activeUser: state.activeUser,
});

const connector = connect(mapStateToProps);
export default connector(DatasetAddZarrView);
