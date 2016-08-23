import com.typesafe.sbt.web.Import._
import sbt._
import sbt.Keys._
import play.Play.autoImport._
import play.sbt.PlayImport
import PlayKeys._
import play.twirl.sbt.Import._
import play.sbt.routes.RoutesKeys._
import sbt.Task
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

object Dependencies{
  val akkaVersion = "2.4.1"
  val reactiveVersion = "0.11.13"
  val reactivePlayVersion = "0.11.13-play24"
  val braingamesVersion = "8.12.4"
  val twelvemonkeysVersion = "3.1.2"

  val restFb = "com.restfb" % "restfb" % "1.6.11"
  val commonsIo = "commons-io" % "commons-io" % "2.4"
  val commonsEmail = "org.apache.commons" % "commons-email" % "1.3.1"
  val commonsLang = "org.apache.commons" % "commons-lang3" % "3.1"
  val akkaTest = "com.typesafe.akka" %% "akka-testkit" % akkaVersion
  val akkaAgent = "com.typesafe.akka" %% "akka-agent" % akkaVersion
  val akkaRemote = "com.typesafe.akka" %% "akka-remote" % akkaVersion
  val akkaLogging = "com.typesafe.akka" %% "akka-slf4j" % akkaVersion
  val scalaLogging = "com.typesafe.scala-logging" %% "scala-logging" % "3.4.0"
  val jerseyClient = "com.sun.jersey" % "jersey-client" % "1.8"
  val jerseyCore = "com.sun.jersey" % "jersey-core" % "1.8"
  val reactivePlay = "org.reactivemongo" %% "play2-reactivemongo" % reactivePlayVersion
  val reactiveBson = "org.reactivemongo" %% "reactivemongo-bson-macros" % reactiveVersion
  val scalaReflect = "org.scala-lang" % "scala-reflect" % "2.11.2"
  val braingamesBinary = "com.scalableminds" %% "braingames-binary" % braingamesVersion
  val braingamesDatastore = "com.scalableminds" %% "braingames-datastore" % braingamesVersion
  val scalaAsync = "org.scala-lang.modules" %% "scala-async" % "0.9.2"
  val airbrake = "com.scalableminds" %% "play-airbrake" % "0.5.0"
  val mongev = "com.scalableminds" %% "play-mongev" % "0.4.1"
  val urlHelper = "com.netaporter" %% "scala-uri" % "0.4.14"
  val tiff = Seq(
      "com.twelvemonkeys.common" % "common-lang" % twelvemonkeysVersion,
      "com.twelvemonkeys.common" % "common-io" % twelvemonkeysVersion,
      "com.twelvemonkeys.common" % "common-image" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" %  "imageio-core" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" %  "imageio-metadata" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" % "imageio-jpeg" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" % "imageio-tiff" % twelvemonkeysVersion
    )
}

object Resolvers {
  val novusRel = "repo.novus rels" at "http://repo.novus.com/releases/"
  val novuesSnaps = "repo.novus snaps" at "http://repo.novus.com/snapshots/"
  val sonaRels = "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/"
  val sonaSnaps = "sonatype snaps" at "https://oss.sonatype.org/content/repositories/snapshots/"
  val sgSnaps = "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/"
  val typesafeRel = "typesafe" at "http://repo.typesafe.com/typesafe/releases"
  val scmRel = "scm.io releases S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/releases/"
  val scmSnaps = "scm.io snapshots S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/snapshots/"
  val teamon = "teamon.eu repo" at "http://repo.teamon.eu"
  val bintray = "scalaz-bintray" at "http://dl.bintray.com/scalaz/releases"
}

object AssetCompilation {
  object SettingsKeys{
    val webpackPath = SettingKey[String]("webpack-path","where webpack is installed")
    val npmPath = SettingKey[String]("npm-path","where npm is installed")
  }

  import SettingsKeys._
  import com.typesafe.sbt.packager.Keys._

  def isWindowsSystem = System.getProperty("os.name").startsWith("Windows")

  private def startProcess(app: String, param: String, base: File) = {
    if(isWindowsSystem)
      Process( "cmd" :: "/c" :: app :: param :: Nil, base )
    else
      if(param != "")
        Process( app :: param :: Nil, base )
      else
        Process( app, base )
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

  private def webpackGenerateTask: Def.Initialize[Task[Any]] = (webpackPath, baseDirectory, streams, target) map { (webpack, base, s, t) =>
    try{
      Future{
        startProcess(webpack, "-w", base) ! s.log
      }
    } catch {
      case e: java.io.IOException =>
        s.log.error("Webpack couldn't be found. Please set the configuration key 'AssetCompilation.webpackPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  private def killWebpack(x: Unit) = {
    val pidFile = Path("target") / "webpack.pid"
    if(pidFile.exists){
      val pid = scala.io.Source.fromFile(pidFile).mkString.trim
      killProcess(pid)
      pidFile.delete()
      println("Pow, Pow. Blood is everywhere, webpack is gone!")
    }
  }

  private def assetsGenerationTask: Def.Initialize[Task[Unit]] = (webpackPath, baseDirectory, streams, target) map { (webpack, base, s, t) =>
    try{
      val exitValue = startProcess(webpack, "--bail", base) ! s.log
      if(exitValue != 0)
        throw new Error(s"Running webpack failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        s.log.error("Webpack couldn't be found. Please set the configuration key 'AssetCompilation.webpackPath' properly. " + e.getMessage)
    }
  } dependsOn npmInstall

  val settings = Seq(
    run in Compile <<= (run in Compile) map(killWebpack) dependsOn webpackGenerateTask,
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
    akkaLogging,
    jerseyClient,
    jerseyCore,
    reactiveBson,
    reactivePlay,
    scalaReflect,
    braingamesBinary,
    braingamesDatastore,
    scalaAsync,
    cache,
    ws,
    scalaLogging,
    airbrake,
    mongev,
    urlHelper,
    specs2 % Test) ++ tiff

  val dependencyResolvers = Seq(
    novusRel,
    novuesSnaps,
    sonaRels,
    sonaSnaps,
    sgSnaps,
    typesafeRel,
    scmRel,
    scmSnaps,
    bintray,
    teamon
  )

  lazy val oxalisSettings = Seq(
    TwirlKeys.templateImports += "oxalis.view.helpers._",
    TwirlKeys.templateImports += "oxalis.view._",
    scalaVersion := "2.11.7",
    scalacOptions += "-target:jvm-1.8",
    version := appVersion,
    webpackPath := (Path("node_modules") / ".bin" / "webpack").getPath,
    npmPath := "npm",
    routesGenerator := InjectedRoutesGenerator,
    libraryDependencies ++= oxalisDependencies,
    //requireJs := Seq("main"),
    //requireJsShim += "main.js",
    resolvers ++= dependencyResolvers,
    //unmanagedResourceDirectories in Compile += target.value / "assets"
    sourceDirectory in Assets := file("none")

    // playAssetsDirectories += baseDirectory.value / "target" / "assets"
  )

  lazy val oxalis: Project = Project(appName, file("."))
    .enablePlugins(play.PlayScala)
    .settings((oxalisSettings ++ AssetCompilation.settings):_*)
}
