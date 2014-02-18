gulp        = require("gulp")
coffee      = require("gulp-coffee")
clean       = require("gulp-clean")
bower       = require("gulp-bower")
eventStream = require("event-stream")
runSequence = require("run-sequence")
exec        = require("gulp-exec")

gulp.task("scripts", ->
  return eventStream.merge(
    gulp.src("client/javascripts/**/*.coffee")
      .pipe(coffee())
      .pipe(gulp.dest(".tmp/javascripts"))
    gulp.src("client/javascripts/**/*.js")
      .pipe(gulp.dest(".tmp/javascripts"))
    gulp.src("public/bower_components/**/*.js")
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
  runSequence("scripts", "require", "clean:tmp", callback)
)