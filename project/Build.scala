import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

import com.typesafe.sbt.web.Import._
import play.sbt.Play.autoImport._
import play.sbt.routes.RoutesKeys._
import play.twirl.sbt.Import._
import sbt.Keys._
import sbt.{Task, _}
import sbtbuildinfo._
import sbtbuildinfo.BuildInfoKeys._

object Dependencies{
  val akkaVersion = "2.4.1"
  val reactiveVersion = "0.11.13"
  val reactivePlayVersion = "0.11.13-play24"
  val braingamesVersion = "11.3.9"

  val twelvemonkeysVersion = "3.1.2"

  val restFb = "com.restfb" % "restfb" % "1.6.11"
  val commonsIo = "commons-io" % "commons-io" % "2.4"
  val commonsEmail = "org.apache.commons" % "commons-email" % "1.3.1"
  val commonsLang = "org.apache.commons" % "commons-lang3" % "3.1"
  val commonsCodec = "commons-codec" % "commons-codec" % "1.10"
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
  val urlHelper = "com.netaporter" %% "scala-uri" % "0.4.14"
  val resourceManager = "com.jsuereth" %% "scala-arm" % "2.0"
  val silhouette = "com.mohiva" %% "play-silhouette" % "3.0.5"
  val silhouetteTestkit = "com.mohiva" %% "play-silhouette-testkit" % "3.0.5" % "test"
  val ceedubs = "net.ceedubs" %% "ficus" % "1.1.2"
  val scalaGuice = "net.codingwell" %% "scala-guice" % "4.0.0"
  val webjars = "org.webjars" %% "webjars-play" % "2.4.0"
  val bootstrap = "com.adrianhurt" %% "play-bootstrap3" % "0.4.4-P24"

  val tiff = Seq(
      "com.twelvemonkeys.common" % "common-lang" % twelvemonkeysVersion,
      "com.twelvemonkeys.common" % "common-io" % twelvemonkeysVersion,
      "com.twelvemonkeys.common" % "common-image" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" %  "imageio-core" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" %  "imageio-metadata" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" % "imageio-jpeg" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" % "imageio-tiff" % twelvemonkeysVersion
    )
  val newrelic = "com.newrelic.agent.java" % "newrelic-agent" % "3.44.1"
  val newrelicApi = "com.newrelic.agent.java" % "newrelic-api" % "3.44.1"
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
  val atlassian = "Atlassian Releases" at "https://maven.atlassian.com/public/"
}

object AssetCompilation {
  object SettingsKeys{
    val webpackPath = SettingKey[String]("webpack-path", "where webpack is installed")
    val npmPath = SettingKey[String]("npm-path", "where npm is installed")
  }

  import SettingsKeys._
  import com.typesafe.sbt.packager.Keys._

  def isWindowsSystem = System.getProperty("os.name").startsWith("Windows")

  private def startProcess(app: String, params: List[String], base: File) = {
    if(isWindowsSystem)
      Process( "cmd" :: "/c" :: app :: params, base )
    else
      Process( app :: params, base )
  }

  private def killProcess(pid: String) = {
    if(isWindowsSystem)
      Process("kill" :: "-f" :: pid :: Nil).run()
    else
      Process("kill" :: pid :: Nil).run()
  }

  private def npmInstall: Def.Initialize[Task[Seq[File]]] = (npmPath, baseDirectory, streams) map { (npm, base, s) =>
    try{
      val exitValue = startProcess(npm, List("install"), base) ! s.log
      if(exitValue != 0)
        throw new Error(s"Running npm failed with exit code: $exitValue")
    } catch {
      case e: java.io.IOException =>
        s.log.error("Npm couldn't be found. Please set the configuration key 'AssetCompilation.npmPath' properly. " + e.getMessage)
    }
    Seq()
  }

  private def webpackGenerateTask: Def.Initialize[Task[Any]] = (webpackPath, baseDirectory, streams, target) map { (webpack, base, s, t) =>
    try{
      Future{
        startProcess(webpack, List("-w"), base) ! s.log
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
      val exitValue = startProcess(webpack, List("--env.production"), base) ! s.log
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
  import AssetCompilation.SettingsKeys._
  import Dependencies._
  import Resolvers._

  val appName =  "oxalis"

  val appVersion = scala.io.Source.fromFile("version").mkString.trim

  val oxalisDependencies = Seq(
    restFb,
    commonsIo,
    commonsEmail,
    commonsLang,
    commonsCodec,
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
    urlHelper,
    newrelic,
    newrelicApi,
    resourceManager,
    silhouette,
    silhouetteTestkit,
    ceedubs,
    scalaGuice,
    webjars,
    bootstrap,
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
    teamon,
    atlassian
  )

  lazy val oxalisSettings = Seq(
    TwirlKeys.templateImports += "oxalis.view.helpers._",
    TwirlKeys.templateImports += "oxalis.view._",
    scalaVersion := "2.11.7",
    scalacOptions += "-target:jvm-1.8",
    version := appVersion,
    webpackPath := (Path("node_modules") / ".bin" / "webpack").getPath,
    npmPath := "yarn",
    routesGenerator := InjectedRoutesGenerator,
    libraryDependencies ++= oxalisDependencies,
    resolvers ++= dependencyResolvers,
    sourceDirectory in Assets := file("none"),
    updateOptions := updateOptions.value.withLatestSnapshots(true),
    unmanagedJars in Compile ++= {
      val libs = baseDirectory.value / "lib"
      val subs = (libs ** "*") filter { _.isDirectory }
      val targets = ( (subs / "target") ** "*" ) filter {f => f.name.startsWith("scala-") && f.isDirectory}
      ((libs +++ subs +++ targets) ** "*.jar").classpath
    }
  )

  lazy val buildInfoSettings = Seq(
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion,
      "commitHash" -> new java.lang.Object() {
        override def toString(): String = {
          try {
            val extracted = new java.io.InputStreamReader(java.lang.Runtime.getRuntime().exec("git rev-parse HEAD").getInputStream())
            (new java.io.BufferedReader(extracted)).readLine()
          } catch {
            case t: Throwable => "get git hash failed"
          }
        }
      }.toString(),
      "commitDate" -> new java.lang.Object() {
        override def toString(): String = {
          try {
            val extracted = new java.io.InputStreamReader(java.lang.Runtime.getRuntime().exec("git log -1 --format=%cd ").getInputStream())
            (new java.io.BufferedReader(extracted)).readLine()

          } catch {
            case t: Throwable => "get git date failed"
          }
        }
      }.toString()
    ),
    buildInfoPackage := "webknossos",
    buildInfoOptions := Seq(BuildInfoOption.ToJson)
  )

  lazy val oxalis: Project = Project(appName, file("."))
    .enablePlugins(play.sbt.PlayScala)
    .enablePlugins(BuildInfoPlugin)
    .settings((oxalisSettings ++ AssetCompilation.settings ++ buildInfoSettings):_*)
}
