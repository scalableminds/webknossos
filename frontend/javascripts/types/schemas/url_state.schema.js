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
    "types::Mesh": {
      type: "object",
      properties: {
        segmentId: { type: "number" },
        seedPosition: {
          $ref: "#/definitions/types::Vector3",
        },
        isPrecomputed: { type: "boolean" },
      },
      additionalProperties: false,
      required: ["segmentId", "seedPosition", "isPrecomputed"],
    },
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
          meshInfo: {
            type: "object",
            properties: {
              meshFileName: { type: "string" },
              meshes: {
                type: "array",
                items: [
                  {
                    $ref: "#/definitions/types::Mesh",
                  },
                ],
              },
            },
            additionalProperties: false,
            required: ["meshes"],
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
    },
  },
};
