import uniqBy from "lodash-es/uniqBy";
import type { MetadataEntryProto } from "types/api_types";

// Kept free of store and reducer imports, as it is also used by the lazily loaded proto_helpers.
export function sanitizeMetadata(metadata: MetadataEntryProto[]) {
  // Workaround for stringList values that are [], even though they
  // should be null. This workaround is necessary because protobuf cannot
  // distinguish between an empty list and a not existent property.
  // Therefore, we clean this up here.
  // Additionally, we ensure uniqueness of the metadata keys just to be
  // extra safe. Actually, duplicate keys should never be saved to the back-end,
  // as duplicate keys will collapse during diffing and only one of the entries
  // will survive.
  return uniqBy(
    metadata.map((prop) => {
      // If stringList value is defined, but it's an empty array, it should
      // be switched to undefined
      const needsCorrection =
        prop.stringListValue != null &&
        prop.stringListValue.length === 0 &&
        (prop.stringValue != null || prop.numberValue != null || prop.boolValue != null);
      if (needsCorrection) {
        return {
          ...prop,
          stringListValue: undefined,
        };
      }
      return prop;
    }),
    (entry) => entry.key,
  );
}
