### define
jquery : $
underscore : _
jadeEngine : Jade
###

getAndCompile = _.memoize (url) ->

  $.ajax(url).pipe (data) -> Jade.compile(data)


JadePlugin = 

	load : (name, parentRequire, load, config) ->

	  url = parentRequire.toUrl("#{name}.jade")

	  getAndCompile(url).done (data) -> load(data)

	  return