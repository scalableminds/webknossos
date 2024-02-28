import { DeleteOutlined } from "@ant-design/icons";
import { createDatasetComposition } from "admin/admin_rest_api";
import {
  AllowedTeamsFormItem,
  DatasetNameFormItem,
  layerNameRules,
} from "admin/dataset/dataset_components";
import { Button, Col, Form, FormInstance, Input, List, Row, Tooltip } from "antd";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import FolderSelection from "dashboard/folders/folder_selection";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { Vector3 } from "oxalis/constants";
import { flatToNestedMatrix } from "oxalis/model/accessors/dataset_accessor";
import { OxalisState } from "oxalis/store";
import React, { useState } from "react";
import { useSelector } from "react-redux";
import { APIDataLayer, APIDataset, APIDatasetId, APITeam, LayerLink } from "types/api_flow_types";
import { syncValidator } from "types/validation";
import { WizardComponentProps } from "./common";
import { useEffectOnlyOnce } from "libs/react_hooks";

const FormItem = Form.Item;

export function ConfigureNewDataset(props: WizardComponentProps) {
  const formRef = React.useRef<FormInstance<any>>(null);

  const onPrev = () => {
    props.setWizardContext((oldContext) => ({
      ...oldContext,
      currentWizardStep: "SelectDatasets",
    }));
  };

  const [isLoading, setIsLoading] = useState(false);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isDatasetManagerOrAdmin = Utils.isUserAdminOrDatasetManager(activeUser);
  const [form] = Form.useForm();
  const [selectedTeams, setSelectedTeams] = useState<APITeam | Array<APITeam>>([]);

  const { wizardContext } = props;
  const linkedDatasets = wizardContext.datasets;

  const onRemoveLayer = (layer: LayerLink) => {
    const oldLayers = form.getFieldValue(["layers"]);
    const newLayers = oldLayers.filter((existingLayer: LayerLink) => existingLayer !== layer);
    form.setFieldsValue({ layers: newLayers });
  };

  const handleTransformImport = async (sourcePoints: Vector3[], targetPoints: Vector3[]) => {
    const datasets = linkedDatasets;
    const transformationArr =
      sourcePoints.length > 0 && targetPoints.length > 0
        ? [
            {
              type: "affine" as const,
              matrix: flatToNestedMatrix(estimateAffineMatrix4x4(sourcePoints, targetPoints)),
            },
          ]
        : [];

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
  };

  useEffectOnlyOnce(() => {
    handleTransformImport(wizardContext.sourcePoints, wizardContext.targetPoints);
  });

  const handleSubmit = async () => {
    if (activeUser == null) {
      throw new Error("Cannot create dataset without being logged in.");
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
        organizationName: activeUser.organization,
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
      <p>Please configure the dataset that is about to be created.</p>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Row gutter={8}>
          <Col span={12}>
            <DatasetNameFormItem activeUser={activeUser} />
          </Col>
          <Col span={12}>
            <AllowedTeamsFormItem
              isDatasetManagerOrAdmin={isDatasetManagerOrAdmin}
              selectedTeams={selectedTeams}
              setSelectedTeams={setSelectedTeams}
              formRef={formRef}
            />
          </Col>
        </Row>

        <FormItemWithInfo
          name="targetFolderId"
          label="Target Folder"
          info="The folder in which the dataset will be created. The dataset can be moved after creation. Note that teams that have access to the specified folder will be able to see the created dataset."
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

        <Form.Item shouldUpdate={(prevValues, curValues) => prevValues.layers !== curValues.layers}>
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
          <Button onClick={onPrev}>Back</Button>

          <Button type="primary" htmlType="submit" loading={isLoading} style={{ marginLeft: 8 }}>
            Create Dataset
          </Button>
        </FormItem>
      </Form>
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
  const layers = Form.useWatch(["layers"]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: See comment below
  React.useEffect(() => {
    // Always validate all fields so that in the case of duplicate layer
    // names all relevant fields are properly validated.
    // This is a workaround, since shouldUpdate=true on a
    // FormItemWithInfo doesn't work for some reason.
    form.validateFields();
  }, [layers, form]);

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
