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

/** The validation errors of an antd form, by field name (nested names joined with "."). */
export type FormFieldErrors = Record<string, string[]>;

export function getFormFieldErrors(fields: FieldData[]): FormFieldErrors {
  return Object.fromEntries(
    fields.map((field) => [[field.name].flat().join("."), field.errors ?? []]),
  );
}

export const hasFormFieldErrors = (errors: FormFieldErrors) =>
  Object.values(errors).some((fieldErrors) => fieldErrors.length > 0);

type RequiredInput = { label: string; isMissing: boolean; field?: string };

/**
 * Lists the inputs that are still missing, followed by the form's validation errors. An empty
 * form field is only listed as missing, not additionally with its "required" validation error.
 */
export function collectRequirements(
  inputs: RequiredInput[],
  formErrors: FormFieldErrors,
): JobRequirement[] {
  const missingInputs = inputs.filter((input) => input.isMissing);
  const missingFields = new Set(missingInputs.map((input) => input.field));
  const errors = Object.entries(formErrors)
    .filter(([field]) => !missingFields.has(field))
    .flatMap(([, fieldErrors]) => fieldErrors);
  return [
    ...missingInputs.map((input) => pendingRequirement(input.label)),
    ...Array.from(new Set(errors)).map(blockingRequirement),
  ];
}
