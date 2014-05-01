### define
underscore : _
backbone : backbone
###

class DatasetModel extends Backbone.Model

  urlRoot : "/api/datasets"
  idAttribute : "name"

  parse : (response) ->

    # since defaults doesn't override null...
    if response.dataSource == null
      response.dataSource =
        needsImport : true
        baseDir : ""
        scale : []

    return response

