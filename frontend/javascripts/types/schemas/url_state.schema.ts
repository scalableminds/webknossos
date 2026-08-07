import pick from "lodash-es/pick";
import { layerViewConfiguration } from "./dataset_view_configuration.schema";

export default {
  $schema: "http://json-schema.org/draft-06/schema#",
  definitions: {
    "types::Vector3": {
      type: "array",
      items: [
        {
          type: "number",
        },
        {
          type: "number",
        },
        {
          type: "number",
        },
      ],
    },
    "types::AdditionalCoordinates": {
      type: "array",
      items: [
        {
          type: "object",
          properties: { name: { type: "string" }, value: { type: "number" } },
        },
      ],
    },
    "types::ViewMode": {
      enum: ["orthogonal", "flight", "volume"],
    },
    "types::MappingType": {
      type: ["string", "null"],
      default: "HDF5",
      description: "If value is 'JSON', it is kept. Any other string is treated as 'HDF5'.",
    },
    "types::Mesh": {
      type: "object",
      properties: {
        // A number is the legacy encoding (kept for permanent backward-compatibility with old
        // shared URLs); a string is the unsigned-decimal encoding used for ids that may exceed
        // the JS Number safe-integer range.
        segmentId: {
          type: ["number", "string"],
        },
        seedPosition: {
          $ref: "#/definitions/types::Vector3",
        },
      },
      required: ["segmentId", "seedPosition"],
    },
    "types::PrecomputedMesh": {
      type: "object",
      allOf: [
        {
          $ref: "#/definitions/types::Mesh",
        },
      ],
      properties: {
        // These need to be repeated due to jsonschema's interpretation of additionalProperties
        // but the type doesn't need to be specified again.
        segmentId: {},
        seedPosition: {},
        isPrecomputed: {
          enum: [true],
        },
        meshFileName: {
          type: "string",
        },
      },
      additionalProperties: false,
      required: ["isPrecomputed", "meshFileName"],
    },
    "types::AdHocMesh": {
      type: "object",
      allOf: [
        {
          $ref: "#/definitions/types::Mesh",
        },
      ],
      properties: {
        // These need to be repeated due to jsonschema's interpretation of additionalProperties
        // but the type doesn't need to be specified again.
        segmentId: {},
        seedPosition: {},
        isPrecomputed: {
          enum: [false],
        },
        mappingName: {
          type: ["string", "null"],
        },
        mappingType: {
          $ref: "#/definitions/types::MappingType",
        },
      },
      additionalProperties: false,
      required: ["isPrecomputed"],
    },
    "types::UrlStateByLayer": {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          mappingInfo: {
            type: "object",
            properties: {
              mappingName: {
                type: "string",
              },
              mappingType: {
                $ref: "#/definitions/types::MappingType",
              },
              agglomerateIdsToImport: {
                type: "array",
                items: [
                  {
                    type: ["number", "string"],
                  },
                ],
              },
            },
            additionalProperties: false,
            required: ["mappingName"],
          },
          meshInfo: {
            type: "object",
            properties: {
              meshFileName: {
                type: ["string", "null"],
              },
              meshes: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      $ref: "#/definitions/types::PrecomputedMesh",
                    },
                    {
                      $ref: "#/definitions/types::AdHocMesh",
                    },
                  ],
                },
              },
            },
            additionalProperties: false,
            required: ["meshes"],
          },
          connectomeInfo: {
            type: "object",
            properties: {
              connectomeName: {
                type: "string",
              },
              agglomerateIdsToImport: {
                type: "array",
                items: [
                  {
                    type: ["number", "string"],
                  },
                ],
              },
            },
            additionalProperties: false,
            required: ["connectomeName"],
          },
          ...pick(layerViewConfiguration, [
            "isDisabled",
            "intensityRange",
            "color",
            "isInverted",
            "gammaCorrectionValue",
          ]),
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
        additionalCoordinates: {
          $ref: "#/definitions/types::AdditionalCoordinates",
        },
        mode: {
          $ref: "#/definitions/types::ViewMode",
        },
        zoomStep: {
          type: "number",
        },
        activeNode: {
          type: "number",
        },
        rotation: {
          $ref: "#/definitions/types::Vector3",
        },
        stateByLayer: {
          $ref: "#/definitions/types::UrlStateByLayer",
        },
        nativelyRenderedLayerName: {
          type: ["string", "null"],
        },
        clippingDistance: {
          type: "number",
        },
        clipSkeletonToCurrentSection: {
          type: "boolean",
        },
      },
      additionalProperties: false,
    },
  },
};
