import {
  AllowedTeamsFormItem,
  CardContainer,
  DatasetNameFormItem,
  DatastoreFormItem,
} from "admin/dataset/dataset_components";
import { hasPricingPlanExceededStorage } from "admin/organization/pricing_plan_utils";
import { sendAnalyticsEvent, type UnfinishedUpload } from "admin/rest_api";
import {
  Alert,
  Button,
  Col,
  Collapse,
  Divider,
  Flex,
  Form,
  type FormInstance,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import FolderSelection from "dashboard/folders/folder_selection";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { isUserAdminOrDatasetManager } from "libs/utils";
import { Vector3Input } from "libs/vector_input";
import messages from "messages";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileWithPath } from "react-dropzone";
import { Link } from "react-router";
import { type APIDataStore, APIJobCommand, type APITeam } from "types/api_types";
import { syncValidator } from "types/validation";
import { AllUnits, LongUnitToShortUnitMap, UnitLong, type Vector3 } from "viewer/constants";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";
import { DatasetFileSelection } from "./upload/dataset_file_selection";
import { inferDatasetName } from "./upload/detect_dataset_format";
import { isInspectionBlockingUpload } from "./upload/inspection_banner";
import { UnfinishedUploadsAlert, useUnfinishedUploads } from "./upload/unfinished_uploads_alert";
import { getUploadFileRules } from "./upload/upload_file_rules";
import { UploadProgressModal } from "./upload/upload_progress_modal";
import { needsConversion, useFileInspection } from "./upload/use_file_inspection";
import { useResumableDatasetUpload } from "./upload/use_resumable_dataset_upload";

const EMPTY_FILES: FileWithPath[] = [];

type UploadFormFieldTypes = {
  name: string;
  initialTeams: Array<APITeam>;
  voxelSizeFactor: Vector3;
  zipFile: Array<FileWithPath>;
  targetFolderId: string;
  voxelSizeUnit: UnitLong;
  datastoreUrl: string;
};

type Props = {
  datastores: Array<APIDataStore>;
  withoutCard?: boolean;
  onUploaded: (
    datasetId: string,
    datasetName: string,
    needsConversion: boolean,
  ) => Promise<void> | void;
};

export const dataPrivacyInfo = (
  <Space orientation="horizontal" size={4}>
    Imported data is private to your organization by default.
    <a
      style={{ color: "var(--ant-color-primary)" }}
      href="https://docs.webknossos.org/webknossos/datasets/settings.html#sharing-permissions-tab"
      target="_blank"
      rel="noopener noreferrer"
    >
      Read more
    </a>
  </Space>
);

function useUploadableDatastores(
  datastores: APIDataStore[],
  form: FormInstance<UploadFormFieldTypes>,
) {
  const uploadableDatastores = useMemo(
    () => datastores.filter((datastore) => datastore.allowsUpload),
    [datastores],
  );
  const selectedDatastoreUrl: string | undefined = Form.useWatch("datastoreUrl", form);

  // The datastores are fetched asynchronously, so preselect the first one once they arrive.
  useEffect(() => {
    if (uploadableDatastores.length > 0 && form.getFieldValue("datastoreUrl") == null) {
      form.setFieldsValue({ datastoreUrl: uploadableDatastores[0].url });
    }
  }, [uploadableDatastores, form]);

  const selectedDatastore =
    uploadableDatastores.length <= 1
      ? uploadableDatastores[0]
      : uploadableDatastores.find((datastore) => datastore.url === selectedDatastoreUrl);
  const isDatasetConversionEnabled =
    selectedDatastore?.jobsSupportedByAvailableWorkers.includes(APIJobCommand.CONVERT_TO_WKW) ??
    false;

  return { uploadableDatastores, selectedDatastoreUrl, isDatasetConversionEnabled };
}

function VoxelSizeFormItems() {
  return (
    <Row gutter={24}>
      <Col xs={24} md={16}>
        <FormItemWithInfo
          name="voxelSizeFactor"
          label="Voxel Size"
          info="The voxel size defines the extent (for x, y, z) of one voxel in the specified unit."
          help="Your dataset is not yet in a WEBKNOSSOS format. Therefore, you need to define the voxel size."
          rules={[
            {
              required: true,
              message: "Please provide a voxel size for the dataset.",
            },
            {
              validator: syncValidator(
                (value: Vector3) => value?.every((el) => el > 0),
                "Each component of the voxel size must be larger than 0.",
              ),
            },
          ]}
        >
          <Vector3Input
            allowDecimals
            disableAutoSize
            style={{ width: "100%" }}
            placeholder="e.g. 11.23, 11.23, 28.3"
          />
        </FormItemWithInfo>
      </Col>
      <Col xs={24} md={8}>
        <FormItemWithInfo
          name="voxelSizeUnit"
          label="Unit"
          info="The unit in which the voxel size is defined."
          rules={[
            {
              required: true,
              message: "Please provide a unit for the voxel size of the dataset.",
            },
          ]}
        >
          <Select
            options={AllUnits.map((unit) => ({
              value: unit,
              label: (
                <span>
                  <Tooltip title={unit}>{LongUnitToShortUnitMap[unit]}</Tooltip>
                </span>
              ),
            }))}
          />
        </FormItemWithInfo>
      </Col>
    </Row>
  );
}

function UploadHelpText() {
  return features().isWkorgInstance ? (
    <Typography.Text>
      Format not listed or upload not working?{" "}
      <a href="mailto:support@webknossos.org">We&apos;ll help you</a>
    </Typography.Text>
  ) : (
    <Typography.Text>
      Format not listed or upload not working?{" "}
      <a
        href="https://docs.webknossos.org/webknossos/data/upload_ui.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        Read the documentation
      </a>
    </Typography.Text>
  );
}

function DatasetUploadView({ datastores, withoutCard, onUploaded }: Props) {
  const activeUser = useWkSelector((state) => state.activeUser);
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const [form] = Form.useForm<UploadFormFieldTypes>();
  const formRef = useRef(form);
  const files: FileWithPath[] = Form.useWatch("zipFile", form) ?? EMPTY_FILES;

  const [selectedTeams, setSelectedTeams] = useState<APITeam | Array<APITeam>>([]);
  const [possibleTeams, setPossibleTeams] = useState<Array<APITeam>>([]);
  const [unfinishedUploadToContinue, setUnfinishedUploadToContinue] =
    useState<UnfinishedUpload | null>(null);

  const { uploadableDatastores, selectedDatastoreUrl, isDatasetConversionEnabled } =
    useUploadableDatastores(datastores, form);
  const inspection = useFileInspection(files);
  const unfinishedUploads = useUnfinishedUploads(selectedDatastoreUrl, activeUser?.organization);
  const upload = useResumableDatasetUpload({
    onUploaded: (datasetId, datasetName, needsConversion) => {
      form.setFieldsValue({ name: "", zipFile: [] });
      setUnfinishedUploadToContinue(null);
      onUploaded(datasetId, datasetName, needsConversion);
    },
    onUploadAborted: () => setUnfinishedUploadToContinue(null),
  });

  useEffect(() => {
    sendAnalyticsEvent("open_upload_view");
  }, []);

  const isStorageExceeded = hasPricingPlanExceededStorage(organization);
  const isContinuingUpload = unfinishedUploadToContinue != null;
  const hasFiles = files.length > 0;
  const areDetailsDisabled = isContinuingUpload || !hasFiles;
  const datasetNeedsConversion = needsConversion(inspection);

  const proposeDatasetName = (selectedFiles: FileWithPath[]) => {
    if (isContinuingUpload || selectedFiles.length === 0) return;
    // Don't overwrite a name the user typed.
    if (form.isFieldTouched("name") && form.getFieldValue("name")) return;
    const name = inferDatasetName(selectedFiles.map((file) => file.path || file.name));
    form.setFieldsValue({ name });
    // Leave it to the user to fill in a name that couldn't be inferred.
    if (name !== "") form.validateFields(["name"]);
  };

  const continueUnfinishedUpload = (unfinishedUpload: UnfinishedUpload) => {
    const teams = possibleTeams.filter((team) => unfinishedUpload.allowedTeams.includes(team.id));
    form.setFieldsValue({
      name: unfinishedUpload.datasetName,
      targetFolderId: unfinishedUpload.folderId,
      initialTeams: teams,
    });
    setSelectedTeams(teams);
    setUnfinishedUploadToContinue(unfinishedUpload);
    Toast.info(
      "To continue the selected upload please make sure to select the same file(s) as before. Otherwise, the upload may be corrupted.",
    );
  };

  const handleSubmit = (formValues: UploadFormFieldTypes) => {
    if (activeUser == null) return;
    upload.startUpload({
      name: formValues.name,
      files: formValues.zipFile,
      organizationId: activeUser.organization,
      initialTeams: formValues.initialTeams,
      targetFolderId: formValues.targetFolderId,
      datastoreUrl: formValues.datastoreUrl,
      needsConversion: datasetNeedsConversion,
      voxelSizeFactor: formValues.voxelSizeFactor,
      voxelSizeUnit: formValues.voxelSizeUnit,
      unfinishedUploadToContinue,
    });
  };

  return (
    <div className="dataset-administration">
      <CardContainer withoutCard={withoutCard} title="Upload Dataset" subtitle={dataPrivacyInfo}>
        {isStorageExceeded ? (
          <Alert
            type="error"
            title={
              <>
                Your organization has exceeded the available storage. Uploading new datasets is
                disabled. Visit the{" "}
                <Link to={`/organizations/${organization.id}`}>organization page</Link> for details.
              </>
            }
            style={{ marginBottom: 24 }}
          />
        ) : null}

        <UnfinishedUploadsAlert
          unfinishedUploads={unfinishedUploads.filter(
            (unfinishedUpload) =>
              unfinishedUpload.uploadId !== unfinishedUploadToContinue?.uploadId,
          )}
          onContinue={continueUnfinishedUpload}
        />

        <Form
          form={form}
          onFinish={handleSubmit}
          onValuesChange={(changedValues: Partial<UploadFormFieldTypes>) => {
            if (changedValues.zipFile != null) proposeDatasetName(changedValues.zipFile);
          }}
          layout="vertical"
          initialValues={{
            initialTeams: [],
            voxelSizeUnit: UnitLong.nm,
            zipFile: [],
            targetFolderId: new URLSearchParams(location.search).get("to"),
          }}
        >
          <Form.Item
            name="zipFile"
            valuePropName="fileList"
            rules={getUploadFileRules({
              organization,
              isActiveUserAdmin: activeUser?.isAdmin ?? false,
              unfinishedUploadToContinue,
            })}
          >
            <DatasetFileSelection
              inspection={inspection}
              isDatasetConversionEnabled={isDatasetConversionEnabled}
            />
          </Form.Item>

          <Typography.Paragraph
            type={hasFiles ? undefined : "secondary"}
            style={{ marginTop: 32, marginBottom: 16 }}
          >
            <strong>Dataset details</strong>
            {hasFiles ? null : " — filled in automatically once you add data"}
          </Typography.Paragraph>
          <Row gutter={24}>
            <Col xs={24} md={8}>
              <DatasetNameFormItem
                activeUser={activeUser}
                label="Name"
                disabled={areDetailsDisabled}
                allowDuplicate
              />
            </Col>
            <Col xs={24} md={8}>
              <FormItemWithInfo
                name="targetFolderId"
                label="Folder"
                info="The folder into which the dataset will be uploaded. The dataset can be moved after upload. Note that teams that have access to the specified folder will be able to see the uploaded dataset."
                valuePropName="folderId"
                rules={[
                  {
                    required: true,
                    message: messages["dataset.import.required.folder"],
                  },
                ]}
              >
                <FolderSelection disableNotEditableFolders disabled={areDetailsDisabled} />
              </FormItemWithInfo>
            </Col>
            <Col xs={24} md={8}>
              <AllowedTeamsFormItem
                label="Additional teams with access"
                isDatasetManagerOrAdmin={isUserAdminOrDatasetManager(activeUser)}
                selectedTeams={selectedTeams}
                setSelectedTeams={setSelectedTeams}
                afterFetchedTeams={setPossibleTeams}
                formRef={formRef}
                disabled={areDetailsDisabled}
              />
            </Col>
          </Row>

          {isDatasetConversionEnabled && datasetNeedsConversion ? <VoxelSizeFormItems /> : null}

          {uploadableDatastores.length > 1 ? (
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: "more-options",
                  label: "More options",
                  forceRender: true,
                  children: (
                    <DatastoreFormItem
                      datastores={uploadableDatastores}
                      disabled={isContinuingUpload}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <DatastoreFormItem datastores={uploadableDatastores} hidden />
          )}

          <Divider />
          <Flex justify="space-between" align="center" gap="middle" wrap>
            <UploadHelpText />
            <Button
              size="large"
              type="primary"
              htmlType="submit"
              disabled={
                isStorageExceeded ||
                isInspectionBlockingUpload(inspection, isDatasetConversionEnabled)
              }
              style={{ minWidth: 160 }}
            >
              Upload
            </Button>
          </Flex>
        </Form>
      </CardContainer>

      <UploadProgressModal status={upload.status} onCancel={upload.cancelUpload} />
    </div>
  );
}

export default DatasetUploadView;
