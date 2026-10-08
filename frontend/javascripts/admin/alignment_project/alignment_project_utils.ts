import type { SectionRange } from "admin/api/alignment_projects";

export function getSectionCount(range: SectionRange): number {
  return range.last - range.first + 1;
}

export function formatSectionRange(range: SectionRange): string {
  return `${range.first}–${range.last} (${getSectionCount(range).toLocaleString()})`;
}

export function getAlignmentRunTypeName(renderUnaligned: boolean): string {
  return renderUnaligned ? "Render Unaligned" : "Align";
}
