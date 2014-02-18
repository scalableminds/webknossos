gulp        = require("gulp")
coffee      = require("gulp-coffee")
clean       = require("gulp-clean")
changed     = require("gulp-changed")
bower       = require("gulp-bower")
eventStream = require("event-stream")
runSequence = require("run-sequence")
exec        = require("gulp-exec")

paths =
  src :
    coffee : ["app/assets/javascripts/**/*.coffee"]
    js : ["app/assets/javascripts/**/*.js"]
  dest :
    js : ".tmp/javascripts"

gulp.task("scripts", ->
  return eventStream.merge(

    gulp.src(paths.src.coffee)
      .pipe(changed(paths.dest.js, extension : ".js"))
      .pipe(coffee())
      .pipe(gulp.dest(paths.dest.js))

    gulp.src(paths.src.js)
      .pipe(changed(paths.dest.js))
      .pipe(gulp.dest(paths.dest.js))

    gulp.src("public/bower_components/**/*.js")
      .pipe(changed(".tmp/bower_components"))
      .pipe(gulp.dest(".tmp/bower_components"))
  )
)

gulp.task("require", ->
  return gulp.src("build.js")
    .pipe(exec("./node_modules/requirejs/bin/r.js -o build.js"))
)

gulp.task("clean:tmp", ->
  return gulp.src([".tmp"], { read: false })
    .pipe(clean())
)

gulp.task("clean:dist", ->
  gulp.src(["public/javascripts"], { read: false })
    .pipe(clean())
)

gulp.task("build", (callback) ->
  runSequence("scripts", "require", callback)
)


gulp.task("watch:scripts", ->
  gulp.watch(paths.src.coffee, (event) ->
    if event.type == "added" or event.type == "changed"
      return gulp.src(event.path)
        .pipe(coffee())
        .pipe(gulp.dest(paths.dest.js))
    return
  )
)