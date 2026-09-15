import Toast from "libs/toast";

export async function copyToClipboard(value: string, label?: string, showValueInToast?: boolean) {
  if (window.getSelection()?.toString()) return;
  await navigator.clipboard.writeText(value);
  const labelPadded = label ? ` ${label}` : "";
  const valueQuotedPadded = value && showValueInToast ? ` “${value}”` : "";
  Toast.success(`Copied${labelPadded}${valueQuotedPadded} to clipboard.`, { timeout: 2000 });
}
