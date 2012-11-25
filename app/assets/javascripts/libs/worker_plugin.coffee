### define
libs/dispatched_worker : DispatchedWorker
###

load : (name, parentRequire, load, config) ->

  load(new DispatchedWorker(parentRequire.toUrl(name)))
  return

