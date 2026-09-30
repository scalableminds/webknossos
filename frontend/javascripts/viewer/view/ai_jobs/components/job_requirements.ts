import type { FormProps } from "antd";

type FieldData = Parameters<NonNullable<FormProps["onFieldsChange"]>>[1][number];

export type StepStatus = "pending" | "done" | "error";

/**
 * Something that still needs to happen before a job can be started.
 * "warning" = not done yet, "error" = a blocking validation error.
 */
export type JobRequirement = {
  label: string;
  severity: "warning" | "error";
};

export const pendingRequirement = (label: string): JobRequirement => ({
  label,
  severity: "warning",
});

export const blockingRequirement = (label: string): JobRequirement => ({
  label,
  severity: "error",
});

/**
 * The validation state of an antd form: its errors by field name (nested names joined with ".")
 * and whether an (asynchronous) validation is still running.
 */
export type FormValidationState = {
  errors: Record<string, string[]>;
  isValidating: boolean;
};

export const EMPTY_FORM_VALIDATION_STATE: FormValidationState = {
  errors: {},
  isValidating: false,
};

export function getFormValidationState(fields: FieldData[]): FormValidationState {
  return {
    errors: Object.fromEntries(
      fields.map((field) => [[field.name].flat().join("."), field.errors ?? []]),
    ),
    isValidating: fields.some((field) => field.validating),
  };
}

/** Whether the form has no errors and no validation is still running. */
export const isFormValid = ({ errors, isValidating }: FormValidationState) =>
  !isValidating && Object.values(errors).every((fieldErrors) => fieldErrors.length === 0);

type RequiredInput = { label: string; isMissing: boolean; field?: string };

/**
 * Lists the inputs that are still missing, followed by the form's validation errors. An empty
 * form field is only listed as missing, not additionally with its "required" validation error.
 * While a validation is running, the job cannot be started either.
 */
export function collectRequirements(
  inputs: RequiredInput[],
  formState: FormValidationState,
): JobRequirement[] {
  const missingInputs = inputs.filter((input) => input.isMissing);
  const missingFields = new Set(missingInputs.map((input) => input.field));
  const errors = Object.entries(formState.errors)
    .filter(([field]) => !missingFields.has(field))
    .flatMap(([, fieldErrors]) => fieldErrors);
  return [
    ...missingInputs.map((input) => pendingRequirement(input.label)),
    ...(formState.isValidating ? [pendingRequirement("Checking your settings…")] : []),
    ...Array.from(new Set(errors)).map(blockingRequirement),
  ];
}
