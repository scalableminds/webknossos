// @ts-nocheck
import _ from "lodash";
import { describe, it, expect } from "vitest";
import { validateObjectWithType } from "types/validation";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import DATASET from "test/fixtures/dataset_server_object";

const datasetViewConfigurationType = "types::DatasetViewConfiguration";
const CORRECT_DATASET_CONFIGURATION = {
  fourBit: false,
  interpolation: true,
  renderMissingDataBlack: true,
  loadingStrategy: "PROGRESSIVE_QUALITY",
  segmentationPatternOpacity: 40,
  layers: {},
  colorLayerOrder: [],
};

describe("Dataset View Configuration Validator", () => {
  it("should report no errors for valid configuration (without optional values)", () => {
    expect(
      validateObjectWithType(datasetViewConfigurationType, CORRECT_DATASET_CONFIGURATION).length,
    ).toBe(0);
  });

  it("should report no errors for valid configuration (with optional values)", () => {
    const validConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);

    validConfiguration.zoom = 3;
    validConfiguration.position = [1, 1, 1];
    validConfiguration.rotation = [1, 1, 1];

    expect(
      validateObjectWithType(datasetViewConfigurationType, CORRECT_DATASET_CONFIGURATION).length,
    ).toBe(0);
  });

  it("should report 1 error for additional property", () => {
    const additionalPropertiesObject = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);

    additionalPropertiesObject.additionalProperty = 1;

    expect(
      validateObjectWithType(datasetViewConfigurationType, additionalPropertiesObject).length,
    ).toBe(1);
  });

  it("should report 1 error for missing property", () => {
    const missingPropertiesObject = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);

    delete missingPropertiesObject.layers;

    expect(
      validateObjectWithType(datasetViewConfigurationType, missingPropertiesObject).length,
    ).toBe(1);
  });

  it("should report 1 error for wrong type", () => {
    const wrongTypeObject = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);

    wrongTypeObject.fourBit = 1;

    expect(validateObjectWithType(datasetViewConfigurationType, wrongTypeObject).length).toBe(1);
  });

  it("validated view configuration should report no errors", () => {
    const validatedConfiguration = {};
    enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);

    expect(
      validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length,
    ).toBe(0);
  });

  it("validated view configuration should remove additional properties", () => {
    const validatedConfiguration = {
      additionalProperty: 1,
    };
    enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);

    expect(
      validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length,
    ).toBe(0);
  });

  it("validated view configuration should not add missing property, when optional", () => {
    const validatedConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);

    delete validatedConfiguration.fourBit;
    enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, true);

    expect(validatedConfiguration.fourBit === undefined).toBe(true);
  });

  it("validated should correctly remove nested additional property for known field", () => {
    const validatedConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);

    validatedConfiguration.fourBit = {
      deeply: "nested",
    };
    enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);

    expect(
      validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length,
    ).toBe(0);
  });

  it("validated should correctly remove nested additional property for unknown field", () => {
    const validatedConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);

    validatedConfiguration.test = {
      deeply: "nested",
    };
    enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);

    expect(
      validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length,
    ).toBe(0);
  });
});
