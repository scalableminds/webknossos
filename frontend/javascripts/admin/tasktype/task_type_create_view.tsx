import AdminPage from "admin/admin_page";
import { createTaskType, getEditableTeams, getTaskType, updateTaskType } from "admin/rest_api";
import RecommendedConfigurationView, {
  getDefaultRecommendedConfiguration,
} from "admin/tasktype/recommended_configuration_view";
import {
  getOnlyItem,
  useIsFetchedSinceMount,
  usePreselectFormValue,
} from "admin/use_preselect_form_value";
import { Button, Col, Form, Input, InputNumber, Radio, Row, Select, Typography, theme } from "antd";
import type { RuleObject } from "antd/es/form";
import {
  CheckboxFormItemWithDescription,
  FormItemWithDescription,
} from "dashboard/dataset/helper_components";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import { jsonStringify } from "libs/utils";
import merge from "lodash-es/merge";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  type APIAllowedMode,
  type APIMagRestrictions,
  type APITaskType,
  type APITeam,
  type TracingType,
  TracingTypeEnum,
} from "types/api_types";
import { syncValidator } from "types/validation";

const RadioGroup = Radio.Group;
const FormItem = Form.Item;
const { TextArea } = Input;

type FormValues = {
  isMagRestricted: boolean;
  summary: string;
  teamId: string;
  description?: string;
  tracingType: TracingType;
  settings: {
    somaClickingAllowed: boolean;
    branchPointsAllowed: boolean;
    volumeInterpolationAllowed: boolean;
    mergerMode: boolean;
    preferredMode?: APIAllowedMode;
    allowedModes: APIAllowedMode[];
    magRestrictions: APIMagRestrictions;
  };
  recommendedConfiguration: string | undefined;
};

const VIEW_MODE_OPTIONS: Array<{ value: APIAllowedMode; label: string }> = [
  { value: "orthogonal", label: "Orthogonal" },
  { value: "flight", label: "Flight" },
];

// Mirrors the backend's AnnotationSettings.defaultFor.
function getDefaultAllowedModes(tracingType: TracingType): APIAllowedMode[] {
  return tracingType === TracingTypeEnum.volume ? ["orthogonal"] : ["orthogonal", "flight"];
}

function isValidMagnification(_rule: RuleObject, value: number | undefined) {
  if (value && (Math.log(value) / Math.log(2)) % 1 === 0) {
    return Promise.resolve();
  } else {
    return Promise.reject(
      new Error("The magnification must be stated as a power of two (e.g., 1 or 2 or 4 or 8 ...)"),
    );
  }
}

function isMinimumMagnifactionLargerThenMaxRule(value: number | undefined, maxMag: number) {
  if (value && value <= maxMag) {
    return Promise.resolve();
  }
  return Promise.reject(
    new Error("The minimum magnification needs to be smaller then the maximum mag."),
  );
}
function isMaximumMagnificationSmallerThenMinRule(value: number | undefined, minMag: number) {
  if (value && value >= minMag) {
    return Promise.resolve();
  }
  return Promise.reject(
    new Error("The maximum magnification needs to be larger then the minimum mag."),
  );
}

function TaskTypeCreateView() {
  const { taskTypeId } = useParams();
  const { token } = theme.useToken();

  const navigate = useNavigate();
  const [useRecommendedConfiguration, setUseRecommendedConfiguration] = useState(false);
  // antd's isFieldTouched can't tell this apart: it also counts values set by code as touched.
  const hasUserPickedAllowedModes = useRef(false);
  const [form] = Form.useForm<FormValues>();
  const allowedModes: APIAllowedMode[] = Form.useWatch(["settings", "allowedModes"], form) ?? [];

  const {
    data: teams = [],
    isLoading: isFetchingTeams,
    dataUpdatedAt: teamsUpdatedAt,
  } = useQueryWithErrorHandling({
    queryKey: ["editableTeams"],
    queryFn: getEditableTeams,
    refetchOnWindowFocus: false,
  });
  const hasFreshTeams = useIsFetchedSinceMount(teamsUpdatedAt);
  usePreselectFormValue(
    form,
    "teamId",
    taskTypeId == null && hasFreshTeams ? getOnlyItem(teams)?.id : undefined,
  );

  const { data: taskType } = useQueryWithErrorHandling({
    queryKey: ["taskTypeForEditing", taskTypeId],
    queryFn: () => getTaskType(taskTypeId as string),
    enabled: taskTypeId != null,
    // Always load the task type freshly when opening the form and never refetch it
    // in the background, so that the user's edits are not overwritten.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    meta: { persist: false },
  });

  // Populate the form with the defaults (or the task type once it is loaded).
  useEffect(() => {
    if (taskTypeId != null && taskType == null) {
      return;
    }

    const defaultValues = {
      isMagRestricted: false,
      settings: {
        somaClickingAllowed: true,
        branchPointsAllowed: true,
        volumeInterpolationAllowed: false,
        mergerMode: false,
        magRestrictions: {
          min: 1,
          max: 512,
        },
      },
      recommendedConfiguration: jsonStringify(getDefaultRecommendedConfiguration()),
    };

    // Use merge which is deep _.extend
    const defaultFormValues: Partial<FormValues> = merge({}, defaultValues, taskType);
    if (taskType == null && defaultFormValues.settings != null) {
      // Not part of defaultValues, because merge would combine the arrays index by index.
      defaultFormValues.settings.allowedModes = getDefaultAllowedModes(TracingTypeEnum.skeleton);
    }
    form.setFieldsValue(defaultFormValues);

    if (taskType?.recommendedConfiguration) {
      //  Only "activate" the recommended configuration checkbox if the existing task type contained one
      setUseRecommendedConfiguration(true);
      form.setFieldValue(
        ["recommendedConfiguration"],
        jsonStringify(taskType?.recommendedConfiguration),
      );
    }

    if (taskType?.settings.magRestrictions.min || taskType?.settings.magRestrictions.max)
      form.setFieldValue(["isMagRestricted"], true);
  }, [form, taskTypeId, taskType]);

  async function onFinish(formValues: FormValues) {
    const {
      settings,
      teamId,
      recommendedConfiguration,
      isMagRestricted: _isMagRestricted,
      ...rest
    } = formValues;
    const teamName = teams.find((team) => team.id === teamId)!["name"];

    if (!settings) {
      return;
    }

    // FormItems which are not rendered/hidden are not serialized by onFinish
    // add them manually
    if (!settings.magRestrictions) {
      settings.magRestrictions = { min: undefined, max: undefined };
    }

    const newTaskType: Omit<APITaskType, "id" | "teamName"> = {
      ...rest,
      // The description is optional, but the API expects the field to be present.
      description: rest.description ?? "",
      teamId,
      settings,
      recommendedConfiguration:
        recommendedConfiguration != null && useRecommendedConfiguration
          ? JSON.parse(recommendedConfiguration)
          : null,
    };

    if (taskTypeId) {
      const updatedTaskType = { ...newTaskType, id: taskTypeId, teamName, settings };
      await updateTaskType(taskTypeId, updatedTaskType);
    } else {
      await createTaskType(newTaskType);
    }

    navigate("/taskTypes");
  }

  // The preferred mode must be one of the allowed modes, so clear it once it isn't anymore.
  function clearPreferredModeIfNotAllowed(newAllowedModes: APIAllowedMode[]) {
    const preferredMode = form.getFieldValue(["settings", "preferredMode"]);
    if (preferredMode != null && !newAllowedModes.includes(preferredMode)) {
      form.setFieldValue(["settings", "preferredMode"], undefined);
      // setFieldValue doesn't revalidate, so an error from the old value would stay visible.
      form.validateFields([["settings", "preferredMode"]]).catch(() => {});
    }
  }

  function onChangeUseRecommendedConfiguration(useRecommendedConfiguration: boolean) {
    setUseRecommendedConfiguration(useRecommendedConfiguration);
  }

  const isEditingMode = taskTypeId != null;
  const titlePrefix = isEditingMode ? "Update" : "Create";
  return (
    <AdminPage
      title={`${titlePrefix} Task Type`}
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/concepts.html"
      description="Define task type behavior, allowed modes, annotation settings, and optional recommended configuration."
      contentMaxWidth={960}
    >
      <div
        style={{
          padding: token.paddingLG,
        }}
      >
        <Form
          form={form}
          onFinish={onFinish}
          onValuesChange={(changedValues: Partial<FormValues>) => {
            if (
              changedValues.tracingType != null &&
              !isEditingMode &&
              !hasUserPickedAllowedModes.current
            ) {
              // Follow the annotation type with the default modes until the user picks some.
              const defaultAllowedModes = getDefaultAllowedModes(changedValues.tracingType);
              form.setFieldValue(["settings", "allowedModes"], defaultAllowedModes);
              clearPreferredModeIfNotAllowed(defaultAllowedModes);
            }
            if (changedValues.settings != null && "allowedModes" in changedValues.settings) {
              hasUserPickedAllowedModes.current = true;
              clearPreferredModeIfNotAllowed(changedValues.settings.allowedModes ?? []);
            }
          }}
          layout="vertical"
          initialValues={{
            tracingType: TracingTypeEnum.skeleton,
          }}
        >
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Basics
          </Typography.Title>

          <Row gutter={token.paddingMD} align="bottom">
            <Col xs={24} md={14}>
              <FormItemWithDescription
                name="summary"
                label="Summary"
                description="Short, unique name used to pick this task type when creating tasks. No commas."
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                  {
                    min: 3,
                  },
                  {
                    validator: syncValidator(
                      (value: string | undefined) => value == null || !value.includes(","),
                      "The summary must not contain commas.",
                    ),
                  },
                ]}
              >
                <Input />
              </FormItemWithDescription>
            </Col>
            <Col xs={24} md={10}>
              <FormItemWithDescription
                name="teamId"
                label="Team"
                description="Its members can use this task type. Its managers can edit it."
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
              >
                <Select
                  showSearch={{ optionFilterProp: "label" }}
                  placeholder="Select a Team"
                  style={{
                    width: "100%",
                  }}
                  loading={isFetchingTeams}
                  options={teams.map((team: APITeam) => ({
                    value: team.id,
                    label: `${team.name}`,
                  }))}
                />
              </FormItemWithDescription>
            </Col>
          </Row>

          <FormItemWithDescription
            name="description"
            label="Description"
            description={
              <>
                Optional. Instructions shown to annotators when they start a task and in the
                viewer&apos;s info tab. Supports{" "}
                <a href="https://markdown-it.github.io/" target="_blank" rel="noopener noreferrer">
                  Markdown
                </a>
                .
              </>
            }
          >
            <TextArea rows={10} />
          </FormItemWithDescription>

          <Typography.Title level={5}>Annotation Behavior</Typography.Title>

          <Row gutter={token.paddingMD} align="bottom">
            <Col xs={24} md={24}>
              <FormItemWithDescription
                name="tracingType"
                label="Annotation Type"
                description="Which annotation layers the tasks' annotations have. Can't be changed later."
              >
                <RadioGroup>
                  <Radio value="skeleton" disabled={isEditingMode}>
                    Skeleton
                  </Radio>
                  <Radio value="volume" disabled={isEditingMode}>
                    Volume
                  </Radio>
                  <Radio value="hybrid" disabled={isEditingMode}>
                    Skeleton and Volume
                  </Radio>
                </RadioGroup>
              </FormItemWithDescription>
            </Col>
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name={["settings", "allowedModes"]}
                label="Allowed Modes"
                description="Orthogonal shows three planes. Flight follows a structure in 3D."
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
              >
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Select all Allowed Modes"
                  showSearch={{ optionFilterProp: "label" }}
                  style={{
                    width: "100%",
                  }}
                  options={VIEW_MODE_OPTIONS}
                />
              </FormItemWithDescription>
            </Col>
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name={["settings", "preferredMode"]}
                label="Preferred Mode"
                description="The view mode tasks open in. Must be one of the allowed modes."
                hasFeedback
                dependencies={[["settings", "allowedModes"]]}
                rules={[
                  // Existing task types may still have a preferred mode that isn't allowed.
                  // Read the allowed modes from the form store: when `dependencies` triggers this
                  // validator, the watched `allowedModes` still holds the previous render's value.
                  ({ getFieldValue }) => ({
                    validator: syncValidator(
                      (value: APIAllowedMode | undefined) =>
                        value == null ||
                        (
                          (getFieldValue(["settings", "allowedModes"]) ?? []) as APIAllowedMode[]
                        ).includes(value),
                      "The preferred mode must be one of the allowed modes.",
                    ),
                  }),
                ]}
              >
                <Select
                  placeholder={
                    allowedModes.length > 0 ? "First allowed mode" : "Select allowed modes first"
                  }
                  disabled={allowedModes.length === 0}
                  allowClear
                  showSearch={{ optionFilterProp: "label" }}
                  style={{
                    width: "100%",
                  }}
                  options={VIEW_MODE_OPTIONS.filter((option) =>
                    allowedModes.includes(option.value),
                  )}
                />
              </FormItemWithDescription>
            </Col>
          </Row>
          <FormItem
            noStyle
            shouldUpdate={(prevValues, curValues) =>
              prevValues.tracingType !== curValues.tracingType
            }
          >
            {({ getFieldValue }) => (
              <div>
                {/* Skeleton-specific */}
                <div
                  style={{
                    // These form items are always emitted here and only their visibility
                    // is changed, since the values are always needed to create/edit
                    // a task type (its schema requires it even though the fields are
                    // irrelevant for volume-only tasks).
                    display:
                      getFieldValue(["tracingType"]) === TracingTypeEnum.volume ? "none" : "block",
                  }}
                >
                  <Row gutter={token.paddingMD}>
                    <Col xs={24} md={12}>
                      <CheckboxFormItemWithDescription
                        name={["settings", "somaClickingAllowed"]}
                        description="Each new node starts a new tree, e.g. to mark cell bodies."
                      >
                        Allow Single-node-tree mode (&quot;Soma clicking&quot;)
                      </CheckboxFormItemWithDescription>
                    </Col>
                    <Col xs={24} md={12}>
                      <CheckboxFormItemWithDescription
                        name={["settings", "branchPointsAllowed"]}
                        description="Lets annotators mark nodes as branchpoints."
                      >
                        Allow Branchpoints
                      </CheckboxFormItemWithDescription>
                    </Col>
                    <Col xs={24} md={12}>
                      <CheckboxFormItemWithDescription
                        name={["settings", "mergerMode"]}
                        description="Opens tasks in merger mode, where a skeleton tree merges the segments it connects."
                      >
                        Merger Mode
                      </CheckboxFormItemWithDescription>
                    </Col>
                  </Row>
                </div>

                {/* Volume-specific */}
                <div
                  style={{
                    // These form items are always emitted here and only their visibility
                    // is changed, since the values are always needed to create/edit
                    // a task type (its schema requires it even though the fields are
                    // irrelevant for skeleton-only tasks).
                    display:
                      getFieldValue(["tracingType"]) === TracingTypeEnum.skeleton
                        ? "none"
                        : "block",
                  }}
                >
                  <Row gutter={token.paddingMD}>
                    <Col xs={24} md={12}>
                      <CheckboxFormItemWithDescription
                        name={["settings", "volumeInterpolationAllowed"]}
                        description="Annotators only need to label every second slice. The slices in between are filled by interpolation."
                      >
                        Allow Volume Interpolation
                      </CheckboxFormItemWithDescription>
                    </Col>
                  </Row>
                </div>
              </div>
            )}
          </FormItem>

          <Typography.Title level={5}>Magnification</Typography.Title>

          <CheckboxFormItemWithDescription
            name={["isMagRestricted"]}
            style={{
              marginBottom: 6,
            }}
            disabled={isEditingMode}
            description="Annotators can only annotate within a range of power-of-two magnifications, e.g. 1 to 2 for the two finest ones. Can't be changed later."
          >
            Restrict Magnifications
          </CheckboxFormItemWithDescription>

          <FormItem
            noStyle
            shouldUpdate={(prevValues, curValues) =>
              !prevValues.isMagRestricted ||
              prevValues.isMagRestricted !== curValues.isMagRestricted
            }
          >
            {({ getFieldValue }) =>
              getFieldValue(["isMagRestricted"]) ? (
                <div
                  style={{
                    marginLeft: 24,
                  }}
                >
                  <Row gutter={token.paddingMD}>
                    <Col xs={24} sm={12}>
                      <FormItem
                        name={["settings", "magRestrictions", "min"]}
                        hasFeedback
                        label="Minimum"
                        style={{
                          marginBottom: 6,
                        }}
                        rules={[
                          {
                            validator: isValidMagnification,
                          },
                          {
                            validator: (_rule, value) =>
                              isMinimumMagnifactionLargerThenMaxRule(
                                value,
                                getFieldValue(["settings", "magRestrictions", "max"]),
                              ),
                          },
                        ]}
                      >
                        <InputNumber min={1} disabled={isEditingMode} />
                      </FormItem>
                    </Col>
                    <Col xs={24} sm={12}>
                      <FormItem
                        name={["settings", "magRestrictions", "max"]}
                        hasFeedback
                        label="Maximum"
                        rules={[
                          {
                            validator: isValidMagnification,
                          },
                          {
                            validator: (_rule, value) =>
                              isMaximumMagnificationSmallerThenMinRule(
                                value,
                                getFieldValue(["settings", "magRestrictions", "min"]),
                              ),
                          },
                        ]}
                      >
                        <InputNumber min={1} disabled={isEditingMode} />
                      </FormItem>
                    </Col>
                  </Row>
                </div>
              ) : null
            }
          </FormItem>

          <Typography.Title level={5}>Recommended Configuration</Typography.Title>

          <FormItem>
            <RecommendedConfigurationView
              form={form}
              enabled={useRecommendedConfiguration}
              onChangeEnabled={onChangeUseRecommendedConfiguration}
            />
          </FormItem>

          <FormItem>
            <Button type="primary" htmlType="submit">
              {`${titlePrefix} Task Type`}
            </Button>
          </FormItem>
        </Form>
      </div>
    </AdminPage>
  );
}

export default TaskTypeCreateView;
