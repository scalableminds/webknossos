import {
  AllowedTeamsFormItem,
  DatasetNameFormItem,
  DatastoreFormItem,
} from "admin/dataset/dataset_components";
import {
  Col,
  Collapse,
  Flex,
  Form,
  type FormInstance,
  InputNumber,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import {
  DatasetTransformationSettingsCard,
  transformationModeOptions,
  useApplyTransformationsToLayers,
} from "dashboard/dataset/dataset_settings_data_tab";
import { FormItemWithInfo } from "dashboard/dataset/helper_components";
import FolderSelection from "dashboard/folders/folder_selection";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrDatasetManager } from "libs/utils";
import messages from "messages";
import type { RefObject } from "react";
import { useState } from "react";
import type { APIDataStore, APITeam } from "types/api_types";
import { syncValidator } from "types/validation";
import { AllUnits, LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";

const AXES = ["X", "Y", "Z"] as const;

function VoxelSizeFactorInput({
  value,
  onChange,
}: {
  value?: Vector3;
  onChange?: (value: Vector3) => void;
}) {
  return (
    <Flex gap={8} style={{ flex: 1, minWidth: 0 }}>
      {AXES.map((axis, index) => (
        <Space.Compact key={axis} style={{ flex: 1, minWidth: 0 }}>
          <Space.Addon className="dataset-remote-mono">{axis}</Space.Addon>
          <InputNumber
            className="dataset-remote-mono"
            style={{ width: "100%" }}
            min={0}
            value={value?.[index]}
            aria-label={`Voxel size ${axis}`}
            onChange={(axisValue) => {
              const newValue: Vector3 = [...(value ?? [0, 0, 0])];
              newValue[index] = axisValue ?? 0;
              onChange?.(newValue);
            }}
          />
        </Space.Compact>
      ))}
    </Flex>
  );
}

function VoxelSizeFormItem() {
  return (
    <FormItemWithInfo
      label={
        <>
          Voxel size{" "}
          <Typography.Text type="secondary" style={{ marginInlineStart: 4 }}>
            · read from the first URL
          </Typography.Text>
        </>
      }
      info="The voxel size defines the extent (for x, y, z) of one voxel in the specified unit."
      required
    >
      <Flex gap={8}>
        <Form.Item
          noStyle
          name={["dataSource", "scale", "factor"]}
          rules={[
            { required: true, message: "Please provide a voxel size for the dataset." },
            {
              validator: syncValidator(
                (value: Vector3) => value?.every((el) => el > 0),
                "Each component of the voxel size must be greater than 0",
              ),
            },
          ]}
        >
          <VoxelSizeFactorInput />
        </Form.Item>
        <Form.Item
          noStyle
          name={["dataSource", "scale", "unit"]}
          rules={[
            {
              required: true,
              message: "Please provide a unit for the voxel scale of the dataset.",
            },
          ]}
        >
          <Select
            style={{ width: 88, flex: "none" }}
            aria-label="Voxel size unit"
            options={AllUnits.map((unit) => ({
              value: unit,
              label: <Tooltip title={unit}>{LongUnitToShortUnitMap[unit]}</Tooltip>,
            }))}
          />
        </Form.Item>
      </Flex>
    </FormItemWithInfo>
  );
}

function TransformationsFormItems({ form }: { form: FormInstance }) {
  const transformationsMode = useApplyTransformationsToLayers(form);
  return (
    <>
      <FormItemWithInfo
        name="transformationsMode"
        label="Transformations"
        info='Remove all transformations with "None", rotate and mirror the dataset with "Simple", or define custom transformations per layer with "Advanced".'
        extra="Affine or thin-plate-spline transforms can also be set later in the dataset settings."
      >
        <Select options={transformationModeOptions} style={{ width: 200 }} />
      </FormItemWithInfo>
      <DatasetTransformationSettingsCard transformationsMode={transformationsMode} form={form} />
    </>
  );
}

function MoreOptions({ form, datastores }: { form: FormInstance; datastores: APIDataStore[] }) {
  const hasDatastoreChoice = datastores.length > 1;
  return (
    <Collapse
      ghost
      className="dataset-remote-more-options"
      items={[
        {
          key: "more-options",
          // Keep the fields mounted, so that they are validated and submitted while collapsed.
          forceRender: true,
          label: (
            <>
              More options{" "}
              <Typography.Text type="secondary">
                · Voxel size, transformations{hasDatastoreChoice ? ", datastore" : ""}
              </Typography.Text>
            </>
          ),
          children: (
            <>
              <Row gutter={24}>
                <Col xs={24} md={hasDatastoreChoice ? 16 : 24}>
                  <VoxelSizeFormItem />
                </Col>
                <Col xs={24} md={8} style={hasDatastoreChoice ? undefined : { display: "none" }}>
                  <DatastoreFormItem datastores={datastores} />
                </Col>
              </Row>
              <TransformationsFormItems form={form} />
            </>
          ),
        },
      ]}
    />
  );
}

/** Name, folder and teams of the new dataset, plus the less common options. */
export function RemoteDatasetDetails({
  form,
  formRef,
  datastores,
}: {
  form: FormInstance;
  formRef: RefObject<FormInstance | null>;
  datastores: APIDataStore[];
}) {
  const activeUser = useWkSelector((state) => state.activeUser);
  const [selectedTeams, setSelectedTeams] = useState<APITeam | Array<APITeam>>([]);

  return (
    <>
      <Typography.Paragraph style={{ marginTop: 32, marginBottom: 4 }}>
        <strong>Dataset details</strong>
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Filled in from the first URL. Change anything before importing.
      </Typography.Paragraph>
      <Row gutter={24}>
        <Col xs={24} md={8}>
          <DatasetNameFormItem activeUser={activeUser} label="Name" />
        </Col>
        <Col xs={24} md={8}>
          <FormItemWithInfo
            name="targetFolderId"
            label="Folder"
            info="The folder into which the dataset will be imported. The dataset can be moved later. Note that teams that have access to the specified folder will be able to see the dataset."
            valuePropName="folderId"
            rules={[{ required: true, message: messages["dataset.import.required.folder"] }]}
          >
            <FolderSelection disableNotEditableFolders />
          </FormItemWithInfo>
        </Col>
        <Col xs={24} md={8}>
          <AllowedTeamsFormItem
            label="Additional teams with access"
            isDatasetManagerOrAdmin={isUserAdminOrDatasetManager(activeUser)}
            selectedTeams={selectedTeams}
            setSelectedTeams={setSelectedTeams}
            formRef={formRef}
          />
        </Col>
      </Row>
      <MoreOptions form={form} datastores={datastores} />
    </>
  );
}
