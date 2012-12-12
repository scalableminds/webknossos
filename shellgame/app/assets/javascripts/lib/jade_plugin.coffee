define [
  "jquery"
  "underscore"
  "jadeEngine"
], ($, _, Jade) ->

  getAndCompile = _.memoize (url) ->

    $.ajax(url).pipe (data) -> Jade.compile(data)


  load : (name, parentRequire, load, config) ->

    url = parentRequire.toUrl("#{name}.jade")

    getAndCompile(url).done (data) -> load(data)

    return