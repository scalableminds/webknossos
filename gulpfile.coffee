gulp        = require("gulp")
coffee      = require("gulp-coffee")
less        = require("gulp-less")
clean       = require("gulp-clean")
changed     = require("gulp-changed")
watch       = require("gulp-watch")
bower       = require("gulp-bower")
eventStream = require("event-stream")
runSequence = require("run-sequence")
exec        = require("gulp-exec")
util        = require("gulp-util")
stream      = require("stream")
path        = require("path")

paths =
  src :
    less : ["app/assets/stylesheets/main.less"]
    coffee : ["app/assets/javascripts/**/*.coffee"]
    js : ["app/assets/javascripts/**/*.js"]
  dest :
    js_tmp : "target/assets/public/javascripts_tmp"
    js : "target/assets/public/javascripts"
    css : "target/assets/public/stylesheets"


watch = (glob) ->

  passStream = new stream.PassThrough()
  passStream._writableState.objectMode = true
  passStream._readableState.objectMode = true

  gulp.watch(glob, (event) ->
    if event.type != "deleted"
      util.log(util.colors.magenta(event.path), event.type)
      gulp.src(event.path).on("data", (chunk) -> passStream.write(chunk); return)
    return
  )

  return passStream


gulp.task("scripts:build", ->
  return eventStream.merge(

    gulp.src(paths.src.coffee)
      .pipe(coffee())
      .pipe(gulp.dest(paths.dest.js_tmp))

    gulp.src(paths.src.js)
      .pipe(gulp.dest(paths.dest.js_tmp))
  )
)

gulp.task("scripts:debug", ->
  return eventStream.merge(

    gulp.src(paths.src.coffee)
      .pipe(coffee())
      .pipe(gulp.dest(paths.dest.js))

    gulp.src(paths.src.js)
      .pipe(gulp.dest(paths.dest.js))
  )
)

gulp.task("styles:build", ->
  return gulp.src(paths.src.less)
    .pipe(less(
      sourceMap : true
    ))
    .pipe(gulp.dest(paths.dest.css))
)

gulp.task("require:build", ->
  return gulp.src("build.js")
    .pipe(exec("./node_modules/requirejs/bin/r.js -o build.js"))
)


gulp.task("clean:tmp", ->
  return gulp.src(paths.dest.js_tmp, read: false)
    .pipe(clean())
)

gulp.task("clean:build", ->
  return gulp.src([paths.dest.js, paths.dest.css], read: false)
    .pipe(clean())
)


gulp.task("watch:scripts:debug", ->
  return eventStream.merge(

    watch(paths.src.coffee)
      .pipe(coffee())
      .pipe(gulp.dest(paths.dest.js))

    watch(paths.src.js)
      .pipe(gulp.dest(paths.dest.js))
  )
)

gulp.task("watch:styles:debug", ->
  return watch(paths.src.less)
    .pipe(less(
      sourceMap : true
    ))
    .pipe(gulp.dest(paths.dest.css))
)


gulp.task("build:scripts", (callback) ->
  runSequence("scripts:build", "require:build", "clean:tmp")
)

gulp.task("build", (callback) ->
  runSequence("clean:build", ["build:scripts", "styles:build"], callback)
)


gulp.task("debug:scripts", (callback) ->
  runSequence("scripts:debug", "watch:scripts:debug", callback)
)
gulp.task("debug:styles", (callback) ->
  runSequence("styles:build", "watch:styles:debug", callback)
)

gulp.task("debug", (callback) ->
  runSequence("clean:build", ["debug:scripts", "debug:styles"], callback)
)


