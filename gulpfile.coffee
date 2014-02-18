gulp        = require("gulp")
coffee      = require("gulp-coffee")
less        = require("gulp-less")
clean       = require("gulp-clean")
eventStream = require("event-stream")
runSequence = require("run-sequence")
exec        = require("gulp-exec")
util        = require("gulp-util")
path        = require("path")
gif         = require("gulp-if")
glob        = require("glob")
stream      = require("stream")
glob2base   = require("glob2base")


paths =
  src :
    css : ["app/assets/stylesheets/main.less"]
    js : ["app/assets/javascripts/**/*.{coffee,js}"]
  dest :
    js_tmp : "public/javascripts_tmp"
    js : "public/javascripts"
    css : "public/stylesheets"


watch = (srcGlob) ->

  passStream = new stream.PassThrough()
  passStream._writableState.objectMode = true
  passStream._readableState.objectMode = true

  if not Array.isArray(srcGlob)
    srcGlob = [ srcGlob ]

  srcGlob.forEach( (srcGlob) ->
    globBase = glob2base(new glob.Glob(srcGlob))

    gulp.watch(srcGlob, (event) ->
      if event.type != "deleted"
        util.log(util.colors.magenta(path.relative(process.cwd(), event.path)), event.type)
        gulp.src(event.path).on("data", (file) -> 
          file.base = path.join(file.cwd, globBase)
          passStream.write(file)
          return
        )
      return
    )

  )
  return passStream

logger = ->

  return eventStream.map((file, callback) ->
    util.log(">>", util.colors.yellow(path.relative(process.cwd(), file.path)))
    callback(null, file)
    return
  )


makeScripts = (dest) ->
  return eventStream.pipeline(
    gif(
      (file) -> return path.extname(file.path) == ".coffee"
      coffee()
    )
    gulp.dest(dest)
    logger()
  )


makeStyles = (dest) ->
  return eventStream.pipeline(
    less( sourceMap : true )
    gulp.dest(dest)
    logger()
  )



gulp.task("compile:scripts:production", ->
  return gulp.src(paths.src.js)
    .pipe(makeScripts(paths.dest.js_tmp))
)

gulp.task("compile:scripts:development", ->
  return gulp.src(paths.src.js)
    .pipe(makeScripts(paths.dest.js))
)

gulp.task("compile:styles", ->
  return gulp.src(paths.src.css)
    .pipe(makeStyles(paths.dest.css))
)

gulp.task("combine:scripts:production", ->
  return gulp.src("build.js")
    .pipe(exec("./node_modules/requirejs/bin/r.js -o build.js"))
)

gulp.task("install:bower", ->
  return gulp.src("bower.json")
    .pipe(exec("./node_modules/bower/bin/bower install"))
)

gulp.task("clean:tmp", ->
  return gulp.src(paths.dest.js_tmp, read: false)
    .pipe(clean())
)

gulp.task("clean:build", ->
  return gulp.src([paths.dest.js, paths.dest.css], read: false)
    .pipe(clean())
)


gulp.task("watch:scripts:development", ->
  return watch(paths.src.js)
    .pipe(makeScripts(paths.dest.js))
)

gulp.task("watch:styles", ->
  return watch(paths.src.css)
    .pipe(makeStyles(paths.dest.css))
)


gulp.task("build:scripts", (callback) ->
  runSequence("compile:scripts:production", "combine:scripts:production", "clean:tmp", callback)
)
gulp.task("build:styles", ["compile:styles"])

gulp.task("build", (callback) ->
  runSequence(["install:bower", "clean:build"], ["build:scripts", "build:styles"], callback)
)


gulp.task("debug:scripts", (callback) ->
  runSequence("compile:scripts:development", "watch:scripts:development", callback)
)
gulp.task("debug:styles", (callback) ->
  runSequence("compile:styles", "watch:styles", callback)
)

gulp.task("debug", (callback) ->
  runSequence(["install:bower", "clean:build"], ["debug:scripts", "debug:styles"], callback)
)


