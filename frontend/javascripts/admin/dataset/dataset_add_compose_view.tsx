import { DeleteOutlined, FileExcelOutlined } from "@ant-design/icons";
import {
  AllowedTeamsFormItem,
  CardContainer,
  DatasetNameFormItem,
  layerNameRules,
} from "admin/dataset/dataset_components";
import { Button, Col, Collapse, Form, FormInstance, Input, List, Radio, Row, Tooltip } from "antd";
import Upload, { UploadChangeParam, UploadFile } from "antd/lib/upload";
import { Vector3 } from "oxalis/constants";
import React, { useState } from "react";
import { readFileAsText } from "libs/read_file";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import { parseNml } from "oxalis/model/helpers/nml_helpers";
import { values } from "libs/utils";
import _ from "lodash";
import { flatToNestedMatrix, formatNestedMatrix } from "oxalis/model/accessors/dataset_accessor";
import { Matrix4x4 } from "libs/mjs";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import messages from "messages";
import FolderSelection from "dashboard/folders/folder_selection";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import * as Utils from "libs/utils";
import {
  APIDataset,
  APIDataLayer,
  APIDatasetId,
  APITeam,
  CoordinateTransformation,
  APIDataStore,
  LayerLink,
} from "types/api_flow_types";
import { syncValidator } from "types/validation";
import { createDatasetComposition, getDataset } from "admin/admin_rest_api";
import Toast from "libs/toast";

const FormItem = Form.Item;

type FileList = UploadFile<any>[];

type Props = {
  onAdded: (
    datasetOrganization: string,
    uploadedDatasetName: string,
    needsConversion?: boolean | null | undefined,
  ) => Promise<void>;
  datastores: APIDataStore[];
};

export default function DatasetAddComposeView(props: Props) {
  const formRef = React.useRef<FormInstance<any>>(null);

  const [isLoading, setIsLoading] = useState(false);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isDatasetManagerOrAdmin = Utils.isUserAdminOrDatasetManager(activeUser);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<FileList>([]);
  const [selectedTeams, setSelectedTeams] = useState<APITeam | Array<APITeam>>([]);
  const [linkedDatasets, setLinkedDatasets] = useState<APIDataset[]>([]);

  const onRemoveLayer = (layer: LayerLink) => {
    const oldLayers = form.getFieldValue(["layers"]);
    const newLayers = oldLayers.filter((existingLayer: LayerLink) => existingLayer !== layer);
    form.setFieldsValue({ layers: newLayers });
  };

  const handleChange = async (info: UploadChangeParam<UploadFile<any>>) => {
    try {
      const newFileList = info.fileList;
      setFileList(newFileList);

      const sourcePoints = [];
      const targetPoints = [];
      if (newFileList.length === 1 && newFileList[0]?.originFileObj) {
        const csv = await readFileAsText(newFileList[0]?.originFileObj);
        console.log("csv", csv);
        const lines = csv.split("\n");
        for (const line of lines) {
          const fields = line.split(",");
          const [_pointName, _enabled, x1, y1, z1, x2, y2, z2] = fields;

          const source = [x1, y1, z1].map((el) => parseInt(el.replaceAll('"', ""))) as Vector3;
          const target = [x2, y2, z2].map((el) => parseInt(el.replaceAll('"', ""))) as Vector3;
          sourcePoints.push(source);
          targetPoints.push(target);
        }
      }

      if (newFileList.length === 2) {
        const nmlString1 = await readFileAsText(newFileList[0]?.originFileObj!);
        const nmlString2 = await readFileAsText(newFileList[1]?.originFileObj!);

        if (nmlString1 === "" || nmlString2 === "") {
          throw new Error("NML files are empty.");
        }

        const { trees: trees1, datasetName: datasetName1 } = await parseNml(nmlString1);
        const { trees: trees2, datasetName: datasetName2 } = await parseNml(nmlString2);

        if (!datasetName1 || !datasetName2) {
          throw new Error("Could not extract dataset names.");
        }

        const [dataset1, dataset2] = await Promise.all([
          getDataset({
            owningOrganization: activeUser?.organization || "",
            name: datasetName1,
          }),
          getDataset({
            owningOrganization: activeUser?.organization || "",
            name: datasetName2,
          }),
        ]);
        console.log("dataset1, dataset2", dataset1, dataset2);

        const nodes1 = Array.from(
          values(trees1)
            .map((tree) => Array.from(tree.nodes.values())[0])
            .values(),
        );
        const nodes2 = Array.from(
          values(trees2)
            .map((tree) => Array.from(tree.nodes.values())[0])
            .values(),
        );

        for (const [node1, node2] of _.zip(nodes1, nodes2)) {
          if ((node1 == null) != (node2 == null)) {
            throw new Error("A tree was empty while its corresponding tree wasn't.");
          }
          if (node1 != null && node2 != null) {
            sourcePoints.push(node1.position);
            targetPoints.push(node2.position);
          }
        }
        const datasets = [dataset1, dataset2];
        setLinkedDatasets(datasets);

        const transformationArr =
          sourcePoints.length > 0 && targetPoints.length > 0
            ? [
                {
                  type: "affine" as const,
                  matrix: flatToNestedMatrix(estimateAffineMatrix4x4(sourcePoints, targetPoints)),
                },
              ]
            : [];
        console.log("transformationArr", transformationArr);
        const newLinks: LayerLink[] = (
          _.flatMap(datasets, (dataset) =>
            dataset.dataSource.dataLayers.map((layer) => [dataset, layer]),
          ) as [APIDataset, APIDataLayer][]
        ).map(
          ([dataset, dataLayer]): LayerLink => ({
            datasetId: {
              owningOrganization: dataset.owningOrganization,
              name: dataset.name,
            },
            sourceName: dataLayer.name,
            newName: dataLayer.name,
            transformations: dataset === datasets[0] ? transformationArr : [],
          }),
        );

        form.setFieldsValue({ layers: newLinks });
      }
    } catch (exception) {
      Toast.error(
        "An error occurred while importing the uploaded files. See the Browser's console for more feedback.",
      );
      console.error(exception);
    }
  };

  const handleSubmit = async () => {
    if (activeUser == null) {
      throw new Error("Cannot upload dataset without being logged in.");
    }
    const layers = form.getFieldValue(["layers"]);

    const uploadableDatastores = props.datastores.filter((datastore) => datastore.allowsUpload);
    const datastoreToUse = uploadableDatastores[0];
    if (!datastoreToUse) {
      Toast.error("Could not find datastore that allows uploading.");
      return;
    }

    const newDatasetName = form.getFieldValue(["name"]);
    setIsLoading(true);
    try {
      await createDatasetComposition(datastoreToUse.url, {
        newDatasetName,
        targetFolderId: form.getFieldValue(["targetFolderId"]),
        organizationName: "sample_organization",
        scale: linkedDatasets[1].dataSource.scale,
        layers,
      });
    } finally {
      setIsLoading(false);
    }

    props.onAdded(activeUser.organization, newDatasetName, false);
  };

  return (
    // Using Forms here only to validate fields and for easy layout
    <div style={{ padding: 5 }}>
      <CardContainer title="Compose a dataset from existing dataset layers">
        <p>
          You can create a new dataset by composing existing datasets together. To align multiple
          datasets with each other, create landmarks nodes using the skeleton tool. Then, download
          these annotations as NMLs and drop them in the following landmarks input. Alternatively,
          you can also add a landmark CSV as it can be exported by Big Warp. WEBKNOSSOS will try to
          find the datasets that are referenced in these files and will create transformations using
          these landmarks.
        </p>

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <FormItem
            name="landmarks"
            label={<React.Fragment>Landmark files (NML pairs or CSV)</React.Fragment>}
            hasFeedback
          >
            <Upload.Dragger
              name="files"
              fileList={fileList}
              onChange={handleChange}
              beforeUpload={() => false}
              maxCount={2}
              multiple
            >
              <p className="ant-upload-drag-icon">
                <FileExcelOutlined
                  style={{
                    margin: 0,
                    fontSize: 35,
                  }}
                />
              </p>
              <p className="ant-upload-text">Drag your landmark files to this area</p>
              <p className="ant-upload-text-hint">...</p>
            </Upload.Dragger>
          </FormItem>

          <Row gutter={8}>
            <Col span={12}>
              <DatasetNameFormItem activeUser={activeUser} />
            </Col>
            <Col span={12}>
              <AllowedTeamsFormItem
                isDatasetManagerOrAdmin={isDatasetManagerOrAdmin}
                selectedTeams={selectedTeams}
                setSelectedTeams={(selectedTeams) => setSelectedTeams(selectedTeams)}
                formRef={formRef}
              />
            </Col>
          </Row>

          <FormItemWithInfo
            name="targetFolderId"
            label="Target Folder"
            info="The folder into which the dataset will be uploaded. The dataset can be moved after upload. Note that teams that have access to the specified folder will be able to see the uploaded dataset."
            valuePropName="folderId"
            rules={[
              {
                required: true,
                message: messages["dataset.import.required.folder"],
              },
            ]}
          >
            <FolderSelection width="50%" disableNotEditableFolders />
          </FormItemWithInfo>

          <Form.Item
            shouldUpdate={(prevValues, curValues) => prevValues.layers !== curValues.layers}
          >
            {({ getFieldValue }) => {
              const layers = getFieldValue("layers") || [];
              return (
                <List
                  locale={{ emptyText: "No Layers" }}
                  header={
                    <div
                      style={{
                        fontWeight: "bold",
                      }}
                    >
                      Layers
                    </div>
                  }
                >
                  {layers.map((layer: LayerLink, idx: number) => (
                    // the layer name may change in this view, the order does not, so idx is the right key choice here
                    <List.Item key={`layer-${idx}`}>
                      <LinkedLayerForm
                        datasetId={layer.datasetId}
                        layer={layer}
                        index={idx}
                        onRemoveLayer={onRemoveLayer}
                        form={form}
                      />
                    </List.Item>
                  ))}
                </List>
              );
            }}
          </Form.Item>

          <FormItem
            style={{
              marginBottom: 0,
            }}
          >
            <Button
              size="large"
              type="primary"
              htmlType="submit"
              loading={isLoading}
              style={{
                width: "100%",
              }}
            >
              Upload
            </Button>
          </FormItem>
        </Form>
      </CardContainer>
    </div>
  );
}

function LinkedLayerForm({
  layer,
  index,
  onRemoveLayer,
  form,
  datasetId,
}: {
  layer: LayerLink;
  index: number;
  onRemoveLayer: (layer: LayerLink) => void;
  form: FormInstance;
  datasetId: APIDatasetId;
}) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const layers = Form.useWatch(["layers"]);

  React.useEffect(() => {
    // Always validate all fields so that in the case of duplicate layer
    // names all relevant fields are properly validated.
    // This is a workaround, since shouldUpdate=true on a
    // FormItemWithInfo doesn't work for some reason.
    form.validateFields();
  }, [layers]);

  return (
    <div
      style={{
        width: "100%",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 12, right: 0, zIndex: 1000 }}>
        <Tooltip title="Remove Layer">
          <Button shape="circle" icon={<DeleteOutlined />} onClick={() => onRemoveLayer(layer)} />
        </Tooltip>
      </div>

      <Row gutter={48}>
        <Col span={24} xl={12}>
          <FormItemWithInfo
            name={["layers", index, "newName"]}
            label="Name"
            style={{
              marginBottom: 24,
            }}
            info="The name of the layer."
            rules={[
              {
                required: true,
                message: "Please provide a valid layer name.",
              },
              ...layerNameRules,
              {
                validator: syncValidator(
                  (value: string) =>
                    layers.filter((someLayer: LayerLink) => someLayer.newName === value).length <=
                    1,
                  "Layer names must be unique.",
                ),
              },
            ]}
          >
            <Input
              style={{
                width: 408,
              }}
            />
          </FormItemWithInfo>
        </Col>
        <Col span={24} xl={12}>
          <FormItemWithInfo
            label="Layer Source"
            info="This is the layer which will be linked into the new dataset."
          >
            <a
              href={`/datasets/${datasetId.owningOrganization}/${datasetId.name}/view`}
              target="_blank"
              rel="noreferrer"
            >
              {datasetId.name}
            </a>{" "}
            / {layer.sourceName}
          </FormItemWithInfo>
        </Col>
      </Row>
    </div>
  );
}
