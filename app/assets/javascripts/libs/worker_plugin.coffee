### define
libs/simple_worker : SimpleWorker
###

load : (name, parentRequire, load, config) ->

  load(new SimpleWorker(parentRequire.toUrl(name)))
  return

