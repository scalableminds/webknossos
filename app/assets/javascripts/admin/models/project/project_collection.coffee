### define
underscore : _
../pagination_collection : PaginationCollection
###

class ProjectCollection extends PaginationCollection

  url : "/api/projects"
  idAttribute : "name"

  parse : ->

    return {"projects":[{"name":"test","team":"Structure of Neocortical Circuits Group","_owner":{"$oid":"52e63da817000016002172d3"}}]}