import sbt._
import sbt.Keys._
import play.Project._
import sbt.Task
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

object Dependencies{
  val akkaVersion = "2.2.0"
  val reactiveVersion = "0.10.0"
  val reactivePlayVersion = "0.10.2"
  val braingamesVersion = "6.10.16-master-fix"

  val restFb = "com.restfb" % "restfb" % "1.6.11"
  val commonsIo = "commons-io" % "commons-io" % "2.4"
  val commonsEmail = "org.apache.commons" % "commons-email" % "1.3.1"
  val commonsLang = "org.apache.commons" % "commons-lang3" % "3.1"
  val akkaTest = "com.typesafe.akka" %% "akka-testkit" % akkaVersion
  val akkaAgent = "com.typesafe.akka" %% "akka-agent" % akkaVersion
  val akkaRemote = "com.typesafe.akka" %% "akka-remote" % akkaVersion
  val jerseyClient = "com.sun.jersey" % "jersey-client" % "1.8"
  val jerseyCore = "com.sun.jersey" % "jersey-core" % "1.8"
  val reactivePlay = "org.reactivemongo" %% "play2-reactivemongo" % reactivePlayVersion
  val reactiveBson = "org.reactivemongo" %% "reactivemongo-bson-macros" % reactiveVersion
  val scalaReflect = "org.scala-lang" % "scala-reflect" % "2.10.0"
  val braingamesBinary = "com.scalableminds" %% "braingames-binary" % braingamesVersion
  val braingamesDatastore = "com.scalableminds" %% "braingames-datastore" % braingamesVersion
  val scalaAsync = "org.scala-lang.modules" %% "scala-async" % "0.9.0-M2"
  val airbrake = "eu.teamon" %% "play-airbrake" % "0.3.5-SCM"
  val mongev = "com.scalableminds" %% "play-mongev" % "0.2.8"
  val playMetrics = "com.kenshoo" %% "metrics-play" % "0.1.3"
  val tiff = Seq(
      "com.twelvemonkeys.common" % "common-lang" % "3.0-rc5",
      "com.twelvemonkeys.common" % "common-io" % "3.0-rc5",
      "com.twelvemonkeys.common" % "common-image" % "3.0-rc5",
      "com.twelvemonkeys.imageio" %  "imageio-core" % "3.0-rc5",
      "com.twelvemonkeys.imageio" %  "imageio-metadata" % "3.0-rc5",
      "com.twelvemonkeys.imageio" % "imageio-jpeg" % "3.0-rc5",
      "com.twelvemonkeys.imageio" % "imageio-tiff" % "3.0-rc5"
    )
}

object Resolvers {
  val novusRel = "repo.novus rels" at "http://repo.novus.com/releases/"
  val novuesSnaps = "repo.novus snaps" at "http://repo.novus.com/snapshots/"
  val sonaRels = "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/"
  val sonaSnaps = "sonatype snaps" at "https://oss.sonatype.org/content/repositories/snapshots/"
  val sgSnaps = "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/"
  val typesafeRel = "typesafe" at "http://repo.typesafe.com/typesafe/releases"
  val scmRel = Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns)
  val scmIntRel = "scm.io intern releases repo" at "http://maven.scm.io/releases/"
  val scmIntSnaps = "scm.io intern snapshots repo" at "http://maven.scm.io/snapshots/"
  val teamon = "teamon.eu repo" at "http://repo.teamon.eu"
}

object AssetCompilation {
  object SettingsKeys{
    val gulpPath = SettingKey[String]("gulp-path","where gulp is installed")
    val npmPath = SettingKey[String]("npm-path","where npm is installed")
  }

  import SettingsKeys._
  import com.typesafe.sbt.packager.universal.Keys._

  def isWindowsSystem = System.getProperty("os.name").startsWith("Windows")

  private def startProcess(app: String, param: String, base: File) = {
    if(isWindowsSystem)
      Process( "cmd" :: "/c" :: app :: param :: Nil, base )
    else
      Process( app :: param :: Nil, base )
  }

  private def killProcess(pid: String) = {
    if(isWindowsSystem)
      Process("kill" :: "-f" :: pid :: Nil).run()
    else
      Process("kill" :: pid :: Nil).run()
  }

  private def npmInstall: Def.Initialize[Task[Seq[File]]] = (npmPath, baseDirectory, streams) map { (npm, base, s) =>
    try{
      startProcess(npm, "install", base ) ! s.log
    } catch {
      case e: java.io.IOException =>
        s.log.error("Npm couldn't be found. Please set the configuration key 'AssetCompilation.npmPath' properly. " + e.getMessage)
    }
    Seq()
  }

  private def gulpGenerateTask: Def.Initialize[Task[Any]] = (gulpPath, baseDirectory, streams, target) map { (gulp, base, s, t) =>
    try{
      Future{
        startProcess(gulp, "debug", base) ! s.log
      }
    } catch {
      case e: java.io.IOException =>
        s.log.error("Gulp couldn't be found. Please set the configuration key 'AssetCompilation.gulpPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  private def killGulp(x: Unit) = {
    val pidFile = Path("target") / "gulp.pid"
    if(pidFile.exists){
      val pid = scala.io.Source.fromFile(pidFile).mkString.trim
      killProcess(pid)
      pidFile.delete()
      println("Pow, Pow. Blood is everywhere, gulp is gone!")
    }
  }

  private def assetsGenerationTask: Def.Initialize[Task[AnyVal]] = (gulpPath, baseDirectory, streams, target) map { (gulp, base, s, t) =>
    try{
      startProcess(gulp, "build", base) ! s.log
    } catch {
      case e: java.io.IOException =>
        s.log.error("Gulp couldn't be found. Please set the configuration key 'AssetCompilation.gulpPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  val settings = Seq(
    run in Compile <<= (run in Compile) map(killGulp) dependsOn gulpGenerateTask,
    stage <<= stage dependsOn assetsGenerationTask,
    dist <<= dist dependsOn assetsGenerationTask
  )
}

object ApplicationBuild extends Build {
  import Dependencies._
  import Resolvers._
  import AssetCompilation.SettingsKeys._

  val appName =  "oxalis"

  val appVersion = scala.io.Source.fromFile("version").mkString.trim

  val oxalisDependencies = Seq(
    restFb,
    commonsIo,
    commonsEmail,
    commonsLang,
    akkaTest,
    akkaAgent,
    akkaRemote,
    jerseyClient,
    jerseyCore,
    reactiveBson,
    reactivePlay,
    scalaReflect,
    braingamesBinary,
    braingamesDatastore,
    scalaAsync,
    cache,
    airbrake,
    playMetrics,
    mongev)++tiff

  val dependencyResolvers = Seq(
    novusRel,
    novuesSnaps,
    sonaRels,
    sonaSnaps,
    sgSnaps,
    typesafeRel,
    scmRel,
    scmIntRel,
    scmIntSnaps,
    teamon
  )

  lazy val oxalisSettings = Seq(
    templatesImport += "oxalis.view.helpers._",
    templatesImport += "oxalis.view._",
    scalaVersion := "2.10.3",
    javacOptions ++= Seq("-source", "1.7", "-target", "1.7"),
    scalacOptions += "-target:jvm-1.7",
    gulpPath := (Path("node_modules") / ".bin" / "gulp").getPath,
    npmPath := "npm",
    //requireJs := Seq("main"),
    //requireJsShim += "main.js",
    resolvers ++= dependencyResolvers,
    lessEntryPoints <<= (sourceDirectory in Compile)(base => base / "none"),
    coffeescriptEntryPoints <<= (sourceDirectory in Compile)(base => base / "none"),
    javascriptEntryPoints <<= (sourceDirectory in Compile)(base => base / "none"),
    unmanagedResourceDirectories in Compile += target.value / "assets"
    // playAssetsDirectories += baseDirectory.value / "target" / "assets"
  )

  lazy val oxalis: Project = play.Project(appName, appVersion, oxalisDependencies, settings = oxalisSettings ++ AssetCompilation.settings)
}

