### define
./settings_view : SettingsView
../category_views/colors_category_view : ColorsCategoryView
../category_views/quality_category_view : QualityCategoryView
###

class DatasetSettingsView extends SettingsView


  id : "dataset-settings"
  className : "flex-column"

  modelName : "datasetConfiguration"


  subviewCreators :

    "colors-category" : ->

      return new ColorsCategoryView(model : @model)

    "quality-category" : ->

      return new QualityCategoryView(model : @model)
