gulp        = require("gulp")
coffee      = require("gulp-coffee")
less        = require("gulp-less")
clean       = require("gulp-clean")
watch       = require("gulp-watch")
eventStream = require("event-stream")
runSequence = require("run-sequence")
exec        = require("gulp-exec")
util        = require("gulp-util")
path        = require("path")
gif         = require("gulp-if")


paths =
  src :
    css : ["app/assets/stylesheets/main.less"]
    js : ["app/assets/javascripts/**/*.{coffee,js}"]
  dest :
    js_tmp : "public/javascripts_tmp"
    js : "public/javascripts"
    css : "public/stylesheets"


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
  return watch(glob : paths.src.js)
    .pipe(makeScripts(paths.dest.js))
)

gulp.task("watch:styles", ->
  return watch(glob : paths.src.css)
    .pipe(makeStyles(paths.dest.css))
)


gulp.task("build:scripts", (callback) ->
  runSequence("compile:scripts:production", "combine:scripts:production", "clean:tmp", callback)
)
gulp.task("build:styles", ["compile:styles"])

gulp.task("build", (callback) ->
  runSequence(["install:bower", "clean:build"], ["build:scripts", "build:styles"], callback)
)


gulp.task("debug:scripts", ["watch:scripts:development"])
gulp.task("debug:styles", ["watch:styles"])

gulp.task("debug", (callback) ->
  runSequence(["install:bower", "clean:build"], ["debug:scripts", "debug:styles"], callback)
)


