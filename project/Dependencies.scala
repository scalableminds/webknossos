import play.sbt.Play.autoImport._
import sbt._


object Dependencies {
  val akkaVersion = "2.4.1"
  val reactiveVersion = "0.11.13"
  val reactivePlayVersion = "0.11.13-play24"
  val braingamesVersion = "11.3.10"

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

  val webknossosDependencies = Seq(
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

}
