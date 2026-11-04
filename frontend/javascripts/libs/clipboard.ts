import Toast from "libs/toast";

function isTextSelectedOutsideFormControls(): boolean {
  // Selected text in a focused input or textarea is reported by window.getSelection(), too.
  // Such a selection is no sign that the user is selecting page content, so it doesn't block copying.
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    return false;
  }
  return Boolean(window.getSelection()?.toString());
}

export async function copyToClipboard(value: string, label?: string, showValueInToast?: boolean) {
  // Don't interfere with the user selecting text, e.g., in an element that copies its value on click.
  if (isTextSelectedOutsideFormControls()) return;
  await navigator.clipboard.writeText(value);
  const labelPadded = label ? ` ${label}` : "";
  const valueQuotedPadded = value && showValueInToast ? ` “${value}”` : "";
  Toast.success(`Copied${labelPadded}${valueQuotedPadded} to clipboard.`, { timeout: 2000 });
}
