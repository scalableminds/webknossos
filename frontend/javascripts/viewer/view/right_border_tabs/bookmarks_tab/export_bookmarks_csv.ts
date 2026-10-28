import { bigIntReplacer } from "libs/bigint_helpers";
import { saveAsCSV, transformToCSVRow } from "libs/csv";
import uniq from "lodash-es/uniq";
import type { APIAnnotationBookmark, MetadataEntryProto } from "types/api_types";
import { bookmarkStateToUrlState } from "viewer/controller/bookmark_state";
import { encodeUrlHash, updateTypeAndId } from "viewer/controller/url_manager";
import type { WebknossosState } from "viewer/store";
import { getDefaultBookmarkName } from "./bookmark_names";

function getMetadataValue(entry: MetadataEntryProto | undefined): string {
  if (entry == null) return "";
  if (entry.stringListValue != null && entry.stringListValue.length > 0) {
    return entry.stringListValue.join(";");
  }
  return String(entry.stringValue ?? entry.numberValue ?? entry.boolValue ?? "");
}

// A link to the annotation that restores the full view of the bookmark.
function getBookmarkLink(state: WebknossosState, bookmark: APIAnnotationBookmark): string {
  const { annotationType, annotationId } = state.annotation;
  const path = updateTypeAndId(location.pathname, annotationType, annotationId);
  const hash = encodeUrlHash(
    JSON.stringify(bookmarkStateToUrlState(bookmark.state), bigIntReplacer),
  );
  return `${location.origin}${path}#${hash}`;
}

export function exportBookmarksAsCSV(state: WebknossosState) {
  const { bookmarks, annotationId } = state.annotation;
  // One column per metadata key, in the order of first occurrence.
  const metadataKeys = uniq(
    bookmarks.flatMap((bookmark) => bookmark.metadata.map(({ key }) => key)),
  );
  const header = transformToCSVRow([
    "name",
    "link",
    "created",
    "createdAtVersion",
    "description",
    ...metadataKeys,
  ]);
  const lines = bookmarks.map((bookmark) =>
    transformToCSVRow([
      bookmark.name ?? getDefaultBookmarkName(bookmark),
      getBookmarkLink(state, bookmark),
      new Date(bookmark.created).toISOString(),
      bookmark.createdAtVersion ?? "",
      bookmark.description ?? "",
      ...metadataKeys.map((key) =>
        getMetadataValue(bookmark.metadata.find((entry) => entry.key === key)),
      ),
    ]),
  );
  saveAsCSV([header], lines, `annotation_bookmarks_${annotationId}.csv`);
}
