import { DeleteOutlined } from "@ant-design/icons";
import {
  AllowedTeamsFormItem,
  DatasetNameFormItem,
  layerNameRules,
} from "admin/dataset/dataset_components";
import { createDatasetComposition, updateDatasetPartial } from "admin/rest_api";
import {
  App,
  Button,
  Checkbox,
  Col,
  Form,
  type FormInstance,
  Input,
  List,
  Row,
  Tooltip,
} from "antd";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import FolderSelection from "dashboard/folders/folder_selection";
import ErrorHandling from "libs/error_handling";
import { estimateAffineMatrix4x4 } from "libs/estimate_affine";
import { formatNumber } from "libs/format_utils";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { isUserAdminOrDatasetManager } from "libs/utils";
import uniqBy from "lodash-es/uniqBy";
import messages from "messages";
import React, { useState } from "react";
import type { APIDataLayer, APIDataset, APITeam, LayerLink, VoxelSize } from "types/api_types";
import { syncValidator } from "types/validation";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { Vector3 } from "viewer/constants";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import {
  buildLiveTransforms,
  flatToNestedMatrix,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { checkLandmarksForThinPlateSpline } from "viewer/model/helpers/transformation_helpers";
import { getFinestVoxelSize, getVoxelSizeScaleFactor } from "viewer/model/scaleinfo";
import type { WizardComponentProps } from "./common";

const FormItem = Form.Item;

async function guardedWithErrorToast(fn: () => Promise<any>) {
  try {
    await fn();
  } catch (error) {
    Toast.error("An unexpected error occurred. Please check the console for details");
    console.error(error);
    ErrorHandling.notify(error as Error);
  }
}

// Scale factors this close to 1 are treated as identity, so that layers whose voxel size already
// matches the new dataset's keep their empty transformation list.
const VOXEL_SIZE_SCALE_EPSILON = 1e-6;

// Adds a scaling transform to each layer that compensates for the difference between its source
// dataset's voxel size and the voxel size of the dataset that is about to be created.
// The transform is emitted in the same 7-matrix format that the Layer Transforms editor produces,
// so that the result stays editable there.
//
// The scaling happens about the coordinate origin: a voxel at index p lies at the physical position
// p * sourceVoxelSize, i.e. at p * scale in the new dataset's voxel grid. A zero pivot makes the
// surrounding translation matrices of the chain identities, so the chain is exactly that scaling.
// The editor rebases the pivot onto the layer's center when the layer is edited, so there is no
// need to express it that way here.
export function withVoxelSizeTransforms(
  layers: LayerLink[],
  linkedDatasets: APIDataset[],
  targetVoxelSize: VoxelSize,
): LayerLink[] {
  return layers.map((layer) => {
    const sourceDataset = linkedDatasets.find((dataset) => dataset.id === layer.sourceDatasetId);
    if (sourceDataset == null) {
      return layer;
    }
    const scale = getVoxelSizeScaleFactor(sourceDataset.dataSource.scale, targetVoxelSize);
    if (scale.every((value) => Math.abs(value - 1) < VOXEL_SIZE_SCALE_EPSILON)) {
      return layer;
    }
    return {
      ...layer,
      transformations: [
        ...layer.transformations,
        ...buildLiveTransforms(scale, [0, 0, 0], [0, 0, 0], [0, 0, 0]),
      ],
    };
  });
}

export function ConfigureNewDataset(props: WizardComponentProps) {
  const formRef = React.useRef<FormInstance<any>>(null);
  const { modal } = App.useApp();

  const onPrev = () => {
    props.setWizardContext((oldContext) => ({
      ...oldContext,
      currentWizardStep: "SelectDatasets",
    }));
  };

  const [isLoading, setIsLoading] = useState(false);
  const activeUser = useWkSelector((state) => state.activeUser);
  const isDatasetManagerOrAdmin = isUserAdminOrDatasetManager(activeUser);
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
      linkedDatasets.flatMap((dataset) =>
        dataset.dataSource.dataLayers.map((layer) => [dataset, layer]),
      ) as [APIDataset, APIDataLayer][]
    ).map(
      ([dataset, dataLayer]): LayerLink => ({
        sourceDatasetId: dataset.id,
        sourceDatasetName: dataset.name,
        sourceLayerName: dataLayer.name,
        targetLayerName: dataLayer.name,
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
    const respectVoxelSize = (form.getFieldValue("respectVoxelSize") ?? false) as boolean;

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
      return layers.map((layer) => {
        const areDatasetsIdentical = layer.sourceDatasetId === linkedDatasets[0].id;
        return {
          ...layer,
          // The first dataset will be transformed to match the second.
          transformations: areDatasetsIdentical ? transformationArr : [],
        };
      });
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
        modal.confirm({
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

    // When the voxel sizes should be respected, the new dataset uses the finest voxel size of all
    // source datasets so that no layer needs to be downscaled.
    const targetVoxelSize = respectVoxelSize
      ? getFinestVoxelSize(linkedDatasets.map((dataset) => dataset.dataSource.scale))
      : linkedDatasets.slice(-1)[0].dataSource.scale;
    if (respectVoxelSize) {
      layersWithTransforms = withVoxelSizeTransforms(
        layersWithTransforms,
        linkedDatasets,
        targetVoxelSize,
      );
    }

    const newDatasetName = form.getFieldValue(["name"]);
    setIsLoading(true);
    try {
      const { newDatasetId } = await createDatasetComposition({
        // keep identifying dataset at orgaId & directoryPath as this is a datastore request.
        newDatasetName,
        targetFolderId: form.getFieldValue(["targetFolderId"]),
        organizationId: activeUser.organization,
        voxelSize: targetVoxelSize,
        layers: layersWithTransforms,
      });

      const uniqueDatasets = uniqBy(layersWithoutTransforms, (layer) => layer.sourceDatasetId);
      const datasetMarkdownLinks = uniqueDatasets
        .map(
          (el) =>
            `- [${el.sourceDatasetName}](/datasets/${getReadableURLPart({ name: el.sourceDatasetName, id: el.sourceDatasetId })})`,
        )
        .join("\n");

      await updateDatasetPartial(newDatasetId, {
        description: [
          "This dataset was composed from:",
          datasetMarkdownLinks,
          "",
          "The layers were combined " +
            (sourcePoints.length === 0
              ? respectVoxelSize
                ? "without any transforms, except for a scaling that compensates for the differing voxel sizes of the source datasets"
                : "without any transforms"
              : `with ${
                  useThinPlateSplines
                    ? `Thin-Plate-Splines (${sourcePoints.length} correspondences)`
                    : `an affine transformation (mean error: ${formatNumber(
                        affineMeanError.meanError,
                      )} vx)`
                }`) +
            ".",
        ].join("\n"),
      });
      props.onAdded(newDatasetId, newDatasetName, false);
    } finally {
      setIsLoading(false);
    }
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
                      datasetId={layer.sourceDatasetId}
                      datasetName={layer.sourceDatasetName}
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
        {wizardContext.sourcePoints.length === 0 && (
          <FormItem name={["respectVoxelSize"]} valuePropName="checked">
            <Checkbox>
              <Tooltip title="If the selected datasets have different voxel sizes, each layer is scaled so that it keeps its physical size. The new dataset then uses the finest voxel size of the selected datasets.">
                Respect voxel size
              </Tooltip>
            </Checkbox>
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
  datasetName,
}: {
  layer: LayerLink;
  index: number;
  onRemoveLayer: (layer: LayerLink) => void;
  form: FormInstance;
  datasetId: string;
  datasetName: string;
}) {
  const layers = Form.useWatch(["layers"]) || [];

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
            name={["layers", index, "targetLayerName"]}
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
                    layers.filter((someLayer: LayerLink) => someLayer.targetLayerName === value)
                      .length <= 1,
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
              href={getViewDatasetURL({ name: datasetName, id: datasetId })}
              target="_blank"
              rel="noreferrer"
            >
              {datasetName}
            </a>{" "}
            / {layer.sourceLayerName}
          </FormItemWithInfo>
        </Col>
      </Row>
    </div>
  );
}
