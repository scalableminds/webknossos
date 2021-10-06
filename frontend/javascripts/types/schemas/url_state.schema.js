// @flow

export default {
  $schema: "http://json-schema.org/draft-06/schema#",
  definitions: {
    "types::Vector3": {
      type: "array",
      items: [{ type: "number" }, { type: "number" }, { type: "number" }],
    },
    "types::ViewMode": {
      enum: ["orthogonal", "oblique", "flight", "volume"],
    },
    "types::MappingType": { enum: ["JSON", "HDF5"] },
    "types::UrlStateByLayer": {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          mappingInfo: {
            type: "object",
            properties: {
              mappingName: { type: "string" },
              mappingType: {
                $ref: "#/definitions/types::MappingType",
              },
              agglomerateIdsToImport: {
                type: "array",
                items: [{ type: "number" }],
              },
            },
            additionalProperties: false,
            required: ["mappingName", "mappingType"],
          },
        },
        additionalProperties: false,
      },
    },
    "types::UrlManagerState": {
      type: "object",
      properties: {
        position: {
          $ref: "#/definitions/types::Vector3",
        },
        mode: {
          $ref: "#/definitions/types::ViewMode",
        },
        zoomStep: { type: "number" },
        activeNode: { type: "number" },
        rotation: {
          $ref: "#/definitions/types::Vector3",
        },
        stateByLayer: {
          $ref: "#/definitions/types::UrlStateByLayer",
        },
      },
      additionalProperties: false,
      required: ["position", "mode", "zoomStep"],
    },
  },
};
