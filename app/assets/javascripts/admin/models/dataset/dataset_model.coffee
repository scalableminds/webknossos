### define
underscore : _
backbone : backbone
###

class DatasetModel extends Backbone.Model

  urlRoot : "/api/datasets"
  idAttribute : "name"

  constructor : (attributes) ->

    # since defaults doesn't override null...
    if attributes.dataSource == null
      attributes.dataSource =
        needsImport : true
        baseDir : ""
        scale : []

    super(attributes)