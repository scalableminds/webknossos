gulp        = require("gulp")
coffee      = require("gulp-coffee")
less        = require("gulp-less")
bump        = require("gulp-bump")
clean       = require("gulp-clean")
watch       = require("gulp-watch")
exec        = require("gulp-exec")
util        = require("gulp-util")
gif         = require("gulp-if")
plumber     = require("gulp-plumber")
eventStream = require("event-stream")
runSequence = require("run-sequence")
path        = require("path")
fs          = require("fs")


paths =
  src :
    css : "app/assets/stylesheets/main.less"
    css_watch : "app/assets/stylesheets/**/*.less"
    js : "app/assets/javascripts/**/*.{coffee,js}"
    version : "#{__dirname}/version"
  dest :
    js_tmp : "public/javascripts_tmp"
    js : "public/javascripts"
    css : "public/stylesheets"
    version : "./{bower,package}.json"


logger = ->

  return eventStream.map((file, callback) ->
    util.log(">>", util.colors.yellow(path.relative(process.cwd(), file.path)))
    callback(null, file)
    return
  )


makeScripts = (dest) ->
  return eventStream.pipeline(
    plumber()
    gif(
      (file) -> return path.extname(file.path) == ".coffee"
      coffee({}).on("error",
        (err) -> util.log(util.colors.red("!!"), err.toString())
      )
    )
    gulp.dest(dest)
    logger()
  )


makeStyles = (dest) ->
  return gulp.src(paths.src.css)
    .pipe(plumber())
    .pipe(
      less({}).on("error",
        (err) -> util.log(util.colors.red("!!"), err.toString())
      )
    )
    .pipe(gulp.dest(dest))
    .pipe(logger())


bumpVersion = (src) ->
  return src.on("data", (versionFile) ->
    versionString = versionFile.contents.toString("utf8")
    gulp.src(paths.dest.version)
      .pipe(bump(version : versionString))
      .pipe(gulp.dest("./"))
      .pipe(logger())
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
  return makeStyles(paths.dest.css)
)

gulp.task("combine:scripts:production", ->
  return gulp.src("build.js")
    .pipe(exec("\"#{path.join(process.cwd(), "node_modules", ".bin", "r.js")}\" -o build.js"))
)

gulp.task("install:bower", ->
  return gulp.src("bower.json")
    .pipe(exec("\"#{path.join(process.cwd(), "node_modules", ".bin", "bower")}\" install -f"))
)

gulp.task("clean:tmp", ->
  return gulp.src(paths.dest.js_tmp, read: false)
    .pipe(clean())
)

gulp.task("clean:build", ->
  return gulp.src(["#{paths.dest.js}/*", "#{paths.dest.css}/*"], read: false)
    .pipe(clean())
)


gulp.task("watch:scripts:development", ->
  return watch(glob : paths.src.js, name : "Script-Watcher")
    .pipe(makeScripts(paths.dest.js))
)

gulp.task("watch:styles", ->
  return watch(glob : paths.src.css_watch, emitOnGlob : false, name : "Style-Watcher", ->
    return makeStyles(paths.dest.css)
  )
)

gulp.task("watch:version", ->
  return bumpVersion(watch(glob : paths.src.version, name : "Version-Watcher"))
)


gulp.task("build:scripts", (callback) ->
  runSequence("compile:scripts:production", "combine:scripts:production", "clean:tmp", callback)
)
gulp.task("build:styles", ["compile:styles"])
gulp.task("build:version", ->
  return bumpVersion(gulp.src(paths.src.version))
)

gulp.task("build", (callback) ->
  runSequence(["install:bower", "clean:build", "build:version"], ["build:scripts", "build:styles"], callback)
)



gulp.task("debug:scripts", ["watch:scripts:development"])
gulp.task("debug:styles", ["compile:styles", "watch:styles"])
gulp.task("debug:version", ["watch:version"])

gulp.task("debug", (callback) ->
  runSequence(["install:bower", "clean:build"], ["debug:scripts", "debug:styles", "debug:version"], callback)
)

gulp.task("default", ["build"])

fs.writeFile("target/gulp.pid", process.pid)
