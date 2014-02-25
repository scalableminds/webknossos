### define
underscore : _
../pagination_collection : PaginationView
###

class DatasetCollection extends PaginationView

  url : "/api/datasets"


  parse : (response) ->

    # when no dataset has been imported yet, set some defaults
    for resp in response
      unless (resp.dataSource)

        resp.dataSource =
          baseDir : ""
          scale : []
          needsImport : true

    return response