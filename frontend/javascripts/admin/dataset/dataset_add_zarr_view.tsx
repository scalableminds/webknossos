import { Form, Input, Button, Col, Row, Divider } from "antd";
import { connect } from "react-redux";
import React, { useState } from "react";
import type { APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { exploreRemoteDataset, putDataset } from "admin/admin_rest_api";
import messages from "messages";
import { jsonStringify } from "libs/utils";
import { CardContainer } from "admin/dataset/dataset_components";
import Password from "antd/lib/input/Password";
import TextArea from "antd/lib/input/TextArea";
import { AsyncButton } from "components/async_clickables";
import Toast from "libs/toast";
import DataLayer from "oxalis/model/data_layer";
import _ from "lodash";
// import { isDatasourceJSONValid } from "types/validation";
const FormItem = Form.Item;
// const Option = Select.Option;
// const { Text } = Typography;
type Props = {
  activeUser: APIUser | null | undefined;
};

function DatasetAddZarrView({ activeUser }: Props) {
  const [datasourceConfig, setDatasourceConfig] = useState<string>();
  // const [exploreLog, setExploreLog] = useState<string>();
  const [datasourceUrls, setDatasourceUrls] = useState<string[]>([
    "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0047A/4496763.zarr",
  ]);
  // const [selectedProtocol, setSelectedProtocol] = useState<string>("https://");
  const [canTryToAddData, setCanTryToAddData] = useState<boolean>(false);

  async function validateUrls(userInput: string) {
    const urls = userInput
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url !== "");

    const faulty = urls.filter(
      (url) => url.indexOf("https://") === -1 && url.indexOf("s3://") === -1,
    );
    console.log("test", faulty);
    if (faulty.length !== 0) {
      setCanTryToAddData(false);
      throw new Error("Protocol not supported.");
    } else {
      setCanTryToAddData(true);
    }
  }

  async function handleExplore() {
    if (datasourceUrls) {
      const datasourceToMerge = await exploreRemoteDataset(datasourceUrls);
      // TODO JSON validation
      if (datasourceToMerge) {
        if (datasourceConfig) {
          // TODO: check that both datasources have same voxel size else warning
          try {
            const currentDatasource = JSON.parse(datasourceConfig);
            const layers = currentDatasource.dataLayers.concat(datasourceToMerge.dataLayers);
            const uniqueLayers = _.uniqBy(layers, (layer: DataLayer) => layer.name);
            currentDatasource.dataLayers = uniqueLayers;
            currentDatasource.id.name = `merge_${currentDatasource.id.name}_${datasourceToMerge.id.name}`;
            setDatasourceConfig(jsonStringify(currentDatasource));
            Toast.error("The datasource config contains invalid JSON.");
            // TODO: refresh datasets in dashboard?
            // TODO: add link to new dataset
          } catch (e) {
            Toast.error("The loaded datasource config contains invalid JSON.");
          }
        } else {
          setDatasourceConfig(jsonStringify(datasourceToMerge));
        }
      } else {
        Toast.error("Exploring this remote dataset did not return a datasource.");
      }
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
                    validateUrls(url);
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
              defaultValue={datasourceUrls}
              onChange={(e) => {
                setDatasourceUrls(
                  e.target.value
                    .split(",")
                    .map((url) => url.trim())
                    .filter((url) => url !== ""),
                );
              }}
            />
          </FormItem>
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
              type="default"
              style={{ width: "100%" }}
              onClick={handleExplore}
              disabled={!canTryToAddData}
            >
              Add
            </AsyncButton>
          </FormItem>
          <Divider />
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
                onClick={handleAddDataset}
                disabled={!datasourceConfig}
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
              placeholder="no data to import"
              value={datasourceConfig}
              onChange={(e) => setDatasourceConfig(e.target.value)}
            />
          </FormItem>
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
