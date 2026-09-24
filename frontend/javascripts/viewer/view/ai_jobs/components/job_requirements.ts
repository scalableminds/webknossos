import type { FieldData } from "@rc-component/form/es/interface";

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

/** Collects the (deduplicated) validation errors of all fields of an antd form. */
export function getFormFieldErrors(fields: FieldData[]): string[] {
  return Array.from(new Set(fields.flatMap((field) => field.errors ?? [])));
}
