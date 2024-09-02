import { DeleteOutlined } from "@ant-design/icons";
import { createDatasetComposition, updateDatasetPartial } from "admin/admin_rest_api";
import {
  AllowedTeamsFormItem,
  DatasetNameFormItem,
  layerNameRules,
} from "admin/dataset/dataset_components";
import { Button, Checkbox, Col, Form, FormInstance, Input, List, Modal, Row, Tooltip } from "antd";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import FolderSelection from "dashboard/folders/folder_selection";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import Toast, { guardedWithErrorToast } from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { flatToNestedMatrix } from "oxalis/model/accessors/dataset_accessor";
import { OxalisState } from "oxalis/store";
import React, { useState } from "react";
import { useSelector } from "react-redux";
import {
  APIDataLayer,
  APIDataset,
  APIDatasetId,
  APITeam,
  areDatasetsIdentical,
  LayerLink,
} from "types/api_flow_types";
import { syncValidator } from "types/validation";
import { WizardComponentProps } from "./common";
import { useEffectOnlyOnce } from "libs/react_hooks";
import { formatNumber } from "libs/format_utils";
import { checkLandmarksForThinPlateSpline } from "oxalis/model/helpers/transformation_helpers";
import { Vector3 } from "oxalis/constants";
import { WkDevFlags } from "oxalis/api/wk_dev";

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

  const handleTransformImport = async () => {
    const newLinks: LayerLink[] = (
      _.flatMap(linkedDatasets, (dataset) =>
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
        transformations: [],
      }),
    );
    form.setFieldsValue({ layers: newLinks });
  };

  useEffectOnlyOnce(() => {
    handleTransformImport();
  });

  const handleSubmit = async () => {
    if (activeUser == null) {
      throw new Error("Cannot create dataset without being logged in.");
    }
    const layersWithoutTransforms = form.getFieldValue(["layers"]) as LayerLink[];
    const useThinPlateSplines = (form.getFieldValue("useThinPlateSplines") ?? false) as boolean;

    const affineMeanError = { meanError: 0 };

    function withTransforms(layers: LayerLink[], sourcePoints: Vector3[], targetPoints: Vector3[]) {
      if (sourcePoints.length + targetPoints.length === 0) {
        return layers;
      }

      const transformationArr = [
        useThinPlateSplines
          ? {
              type: "thin_plate_spline" as const,
              correspondences: { source: sourcePoints, target: targetPoints },
            }
          : {
              type: "affine" as const,
              matrix: flatToNestedMatrix(
                estimateAffineMatrix4x4(sourcePoints, targetPoints, affineMeanError),
              ),
            },
      ];
      if (useThinPlateSplines) {
        checkLandmarksForThinPlateSpline(sourcePoints, targetPoints);
      }
      return layers.map((layer) => ({
        ...layer,
        // The first dataset will be transformed to match the second.
        transformations: areDatasetsIdentical(layer.datasetId, linkedDatasets[0])
          ? transformationArr
          : [],
      }));
    }

    const uploadableDatastores = props.datastores.filter((datastore) => datastore.allowsUpload);
    const datastoreToUse = uploadableDatastores[0];
    if (!datastoreToUse) {
      Toast.error("Could not find datastore that allows uploading.");
      return;
    }

    let layersWithTransforms;
    const { sourcePoints, targetPoints } = wizardContext;
    try {
      layersWithTransforms = withTransforms(layersWithoutTransforms, sourcePoints, targetPoints);
    } catch (exception) {
      const tryAugmentation = await new Promise((resolve) => {
        Modal.confirm({
          title: "Augment landmarks?",
          content:
            "The provided landmarks can't be used for affine estimation, possibly " +
            "due to their planar nature. Should a constant translation in the Z " +
            "direction be assumed, and the landmarks adjusted accordingly?",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      const augmentLandmarks = (points: Vector3[]) =>
        points.concat(points.map((p) => [p[0], p[1], p[2] + 1]));
      if (tryAugmentation) {
        layersWithTransforms = withTransforms(
          layersWithoutTransforms,
          augmentLandmarks(sourcePoints),
          augmentLandmarks(targetPoints),
        );
      } else {
        throw exception;
      }
    }

    const newDatasetName = form.getFieldValue(["name"]);
    setIsLoading(true);
    try {
      await createDatasetComposition(datastoreToUse.url, {
        newDatasetName,
        targetFolderId: form.getFieldValue(["targetFolderId"]),
        organizationId: activeUser.organization,
        voxelSize: linkedDatasets.slice(-1)[0].dataSource.scale,
        layers: layersWithTransforms,
      });

      const uniqueDatasets = _.uniqBy(
        layersWithoutTransforms.map((layer) => layer.datasetId),
        (id) => id.owningOrganization + "-" + id.name,
      );
      const datasetMarkdownLinks = uniqueDatasets
        .map((el) => `- [${el.name}](/datasets/${el.owningOrganization}/${el.name})`)
        .join("\n");

      await updateDatasetPartial(
        { owningOrganization: activeUser.organization, name: newDatasetName },
        {
          description: [
            "This dataset was composed from:",
            datasetMarkdownLinks,
            "",
            "The layers were combined " +
              (sourcePoints.length === 0
                ? "without any transforms"
                : `with ${
                    useThinPlateSplines
                      ? `Thin-Plate-Splines (${sourcePoints.length} correspondences)`
                      : `an affine transformation (mean error: ${formatNumber(
                          affineMeanError.meanError,
                        )} vx)`
                  }`) +
              ".",
          ].join("\n"),
        },
      );
    } finally {
      setIsLoading(false);
    }

    props.onAdded(activeUser.organization, newDatasetName, false);
  };

  return (
    // Using Forms here only to validate fields and for easy layout
    <div style={{ padding: 5 }}>
      <p>Please configure the dataset that is about to be created.</p>
      <Form form={form} layout="vertical" onFinish={() => guardedWithErrorToast(handleSubmit)}>
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
        {WkDevFlags.datasetComposition.allowThinPlateSplines &&
          wizardContext.sourcePoints.length > 0 && (
            <FormItem name={["useThinPlateSplines"]} valuePropName="checked">
              <Checkbox>Use Thin-Plate-Splines (Experimental)</Checkbox>
            </FormItem>
          )}

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
