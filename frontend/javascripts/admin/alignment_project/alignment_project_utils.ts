import type { SectionRange } from "admin/api/alignment_projects";

export function getSectionCount(range: SectionRange): number {
  return range.last - range.first + 1;
}

// E.g. "8 (z=5–12)", or "All 8 (z=5–12)" if the range covers all sections of the project.
export function formatSectionRange(range: SectionRange, isAllSections = false): string {
  const formatted = `${getSectionCount(range).toLocaleString()} (z=${range.first}–${range.last})`;
  return isAllSections ? `All ${formatted}` : formatted;
}

export function getAlignmentRunTypeName(renderUnaligned: boolean): string {
  return renderUnaligned ? "Render Unaligned" : "Align";
}
