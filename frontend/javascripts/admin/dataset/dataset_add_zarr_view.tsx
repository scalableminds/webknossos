import { Form, Input, Button, Col, Row, Divider } from "antd";
import { connect } from "react-redux";
import React, { useState } from "react";
import type { APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { exploreRemoteDataset, storeRemoteDataset } from "admin/admin_rest_api";
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
    "s3://s3.amazonaws.com/webknossos-zarr/demodata/l4_sample_zarr/color.zarr/1/",
  ]);
  const [usernameOrAccessKey, setUsernameOrAccessKey] = useState<string>("");
  const [passwordOrSecretKey, setPasswordOrSecretKey] = useState<string>("");
  const [selectedProtocol, setSelectedProtocol] = useState<string>("https://");
  const [canStartExplore, setCanStartExplore] = useState<boolean>(false);

  function validateUrls(userInput: string) {
    if (userInput) {
      const urls = userInput
        .split(",")
        .map((url) => url.trim())
        .filter((url) => url !== "");

      // any url must begin with one of the accepted protocols
      const faulty = urls.filter(
        (url) =>
          !(
            (url.indexOf("https://") === 0 && url.indexOf("s3://") !== 0) ||
            (url.indexOf("https://") !== 0 && url.indexOf("s3://") === 0)
          ),
      );
      
      if (faulty.length !== 0) {
        setCanStartExplore(false);
        throw new Error("Dataset URLs must employ either the https:// or s3:// protocol.");
      } else {
        setSelectedProtocol(urls[0].indexOf("https://") === 0 ? "https://" : "s3://");
        setCanStartExplore(true);
      }
    }
  }

  async function handleExplore() {
    if (datasourceUrls) {
      const datasourceToMerge = await exploreRemoteDataset(datasourceUrls, {
        username: usernameOrAccessKey,
        pass: passwordOrSecretKey,
      });
      if (datasourceToMerge) {
        if (datasourceConfig) {
          // TODO: check that both datasources have same voxel size else warning
          let currentDatasource;
          try {
            currentDatasource = JSON.parse(datasourceConfig);
          } catch (e) {
            Toast.error("The loaded datasource config contains invalid JSON.");
            return;
          }
          const layers = currentDatasource.dataLayers.concat(datasourceToMerge.dataLayers);
          const uniqueLayers = _.uniqBy(layers, (layer: DataLayer) => layer.name);
          currentDatasource.dataLayers = uniqueLayers;
          currentDatasource.id.name = `merge_${currentDatasource.id.name}_${datasourceToMerge.id.name}`;
          setDatasourceConfig(jsonStringify(currentDatasource));
          // TODO: refresh datasets in dashboard?
          // TODO: toast link to new dataset
        } else {
          setDatasourceConfig(jsonStringify(datasourceToMerge));
        }
      } else {
        Toast.error("Exploring this remote dataset did not return a datasource.");
      }
    } else {
      Toast.error("Please provide a valid URL for exploration.");
    }
  }

  async function handleStoreDataset() {
    if (datasourceConfig && activeUser) {
      let configJSON;
      try {
        configJSON = JSON.parse(datasourceConfig);
      } catch (e) {
        Toast.error("The loaded datasource config contains invalid JSON.");
        return;
      }
      const result = await storeRemoteDataset(
        configJSON.id.name,
        activeUser.organization,
        datasourceConfig,
      );
      console.log(result);
      if (result) {
        const href = `/datasets/${activeUser.organization}/${configJSON.id.name}/`;
        Toast.success(
          <React.Fragment>
            The datasource configuration was stored successfully.
            <br />
            Click{" "}
            <a target="_blank" href={href} rel="noopener noreferrer">
              here
            </a>{" "}
            to view the dataset.
          </React.Fragment>,
        );
      }
    }
  }

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
          {datasourceUrls.length > 1 ? (
            <Hint style={{ marginTop: canStartExplore ? -16 : 0, marginLeft: 12 }}>
              Please ensure that all URLs can be accessed with the same credentials when adding
              multiple URLs.
            </Hint>
          ) : null}
          <Row gutter={8}>
            <Col span={12}>
              <FormItem
                name="username"
                label={selectedProtocol === "https://" ? "Username" : "Access Key"}
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
                name="password"
                label={selectedProtocol === "https://" ? "Password" : "Secret Key"}
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
                onClick={handleStoreDataset}
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
