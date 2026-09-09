// Kept out of dataset_settings_data_tab so that the settings provider can reference the enum
// without statically importing the whole (lazily loaded) tab.
export enum TransformationsMode {
  NONE = "none",
  SIMPLE = "simple",
  ADVANCED = "advanced",
}
