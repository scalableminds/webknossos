import play.sbt.Play.autoImport._
import sbt._


object Dependencies {
  val playVersion = "2.4.6"
  val akkaVersion = "2.4.1"
  val reactiveVersion = "0.11.13"
  val reactivePlayVersion = "0.11.13-play24"
  val braingamesVersion = "11.3.9"
  val twelvemonkeysVersion = "3.1.2"
  val log4jVersion = "2.0-beta9"
  val newrelicVersion = "3.44.1"
  val webknossosWrapVersion = "1.1.4"

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
  val scalaAsync = "org.scala-lang.modules" %% "scala-async" % "0.9.2"
  val airbrake = "com.scalableminds" %% "play-airbrake" % "0.5.0"
  val urlHelper = "com.netaporter" %% "scala-uri" % "0.4.14"
  val resourceManager = "com.jsuereth" %% "scala-arm" % "2.0"
  val silhouette = "com.mohiva" %% "play-silhouette" % "3.0.5"
  val playFramework = "com.typesafe.play" %% "play" % playVersion
  val silhouetteTestkit = "com.mohiva" %% "play-silhouette-testkit" % "3.0.5" % "test"
  val ceedubs = "net.ceedubs" %% "ficus" % "1.1.2"
  val scalaGuice = "net.codingwell" %% "scala-guice" % "4.0.0"
  val webjars = "org.webjars" %% "webjars-play" % "2.4.0"
  val rocksDB = "org.rocksdb" % "rocksdbjni" % "5.1.2"
  val bootstrap = "com.adrianhurt" %% "play-bootstrap3" % "0.4.4-P24"
  val log4jCore =  "org.apache.logging.log4j" % "log4j-api" % log4jVersion
  val log4jApi = "org.apache.logging.log4j" % "log4j-core" % log4jVersion
  val liftBox = "net.liftweb" % "lift-common_2.10" % "2.6-M3"
  val liftUtil = "net.liftweb" % "lift-util_2.10" % "3.0-M1"
  val alphanumericComparator = "se.sawano.java" % "alphanumeric-comparator" % "1.4.1"
  val scalapbJson = "com.scalableminds" %% "scalapb-json4s" % "0.3.2.0-scm"
  val xmlWriter = "org.glassfish.jaxb" % "txw2" % "2.2.11"
  val webknossosWrap = "com.scalableminds" %% "webknossos-wrap" % webknossosWrapVersion
  val websockets = "org.java-websocket" % "Java-WebSocket" % "1.3.0"

  // Unfortunately, we need to list all mturk dependencies seperately since mturk is not published on maven but rather
  // added to the project as a JAR. To keep the number of JARs added to this repo as small as possible, everthing that
  // lives on maven is added here.
  val mturk = Seq(
    "log4j" % "log4j" % "1.2.17",
    "org.apache.axis" % "axis" % "1.4",
    "org.apache.axis" % "axis-jaxrpc" % "1.4",
    "org.apache.axis" % "axis-saaj" % "1.4",
    "org.apache.axis" % "axis-ant" % "1.4",
    "commons-beanutils" % "commons-beanutils" % "1.7.0",
    "commons-collections" % "commons-collections" % "3.2",
    "commons-dbcp" % "commons-dbcp" % "1.2.2",
    "commons-digester" % "commons-digester" % "1.8",
    "commons-logging" % "commons-logging-api" % "1.0.4",
    "commons-logging" % "commons-logging" % "1.0.4",
    "commons-pool" % "commons-pool" % "1.3",
    "commons-lang" % "commons-lang" % "2.3",
    "commons-discovery" % "commons-discovery" % "0.2",
    "dom4j" % "dom4j" % "1.6.1",
    "org.apache.httpcomponents" % "httpclient" % "4.1.2",
    "org.apache.httpcomponents" % "httpcore" % "4.1.2",
    "org.apache.httpcomponents" % "httpmime" % "4.1.2",
    "org.apache.httpcomponents" % "httpclient-cache" % "4.1.2",
    "xalan" % "xalan" % "2.7.1",
    "com.amazonaws" % "aws-java-sdk" % "1.11.26",
    "xerces" % "xercesImpl" % "2.9.1",
    "xml-resolver" % "xml-resolver" % "1.2",
    "xml-apis" % "xml-apis" % "1.4.01",
    "org.codehaus.woodstox" % "wstx-asl" % "3.2.3",
    "wsdl4j" % "wsdl4j" % "1.5.1",
    "org.apache.ws.jaxme" % "jaxmeapi" % "0.5.2",
    "org.apache.ws.jaxme" % "jaxme2" % "0.5.2",
    "org.apache.ws.jaxme" % "jaxmexs" % "0.5.2",
    "org.apache.ws.jaxme" % "jaxmejs" % "0.5.2",
    "org.apache.ws.jaxme" % "jaxmepm" % "0.5.2",
    "org.apache.ws.jaxme" % "jaxme2-rt" % "0.5.2",
    "org.apache.velocity" % "velocity" % "1.5",
    "velocity-tools" % "velocity-tools" % "1.4",
    "net.sf.opencsv" % "opencsv" % "1.8",
    "org.apache.geronimo.specs" % "geronimo-activation_1.0.2_spec" % "1.2",
    "org.apache.geronimo.specs" % "geronimo-javamail_1.3.1_spec" % "1.3"
  )

  val tiff = Seq(
      "com.twelvemonkeys.common" % "common-lang" % twelvemonkeysVersion,
      "com.twelvemonkeys.common" % "common-io" % twelvemonkeysVersion,
      "com.twelvemonkeys.common" % "common-image" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" %  "imageio-core" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" %  "imageio-metadata" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" % "imageio-jpeg" % twelvemonkeysVersion,
      "com.twelvemonkeys.imageio" % "imageio-tiff" % twelvemonkeysVersion
    )
  val newrelic = "com.newrelic.agent.java" % "newrelic-agent" % newrelicVersion
  val newrelicApi = "com.newrelic.agent.java" % "newrelic-api" % newrelicVersion

  val utilDependencies = Seq(
    playFramework,
    log4jCore,
    log4jApi,
    commonsIo,
    commonsEmail,
    commonsLang,
    reactiveBson,
    reactivePlay,
    ws,
    akkaAgent,
    akkaRemote,
    scalaLogging,
    liftBox,
    liftUtil,
    scalapbJson
  )

  val braingamesBinaryDependencies = Seq(
    webknossosWrap,
    playFramework,
    log4jCore,
    log4jApi,
    commonsIo,
    commonsEmail,
    commonsLang,
    alphanumericComparator,
    reactiveBson,
    reactivePlay,
    akkaAgent,
    akkaRemote,
    scalaLogging,
    liftBox,
    liftUtil,
    newrelic,
    newrelicApi,
    xmlWriter,
    rocksDB,
    scalapbJson) ++ tiff

  val braingamesDatastoreDependencies = Seq(
    akkaAgent,
    websockets,
    ws,
    cache,
    liftBox,
    scalaLogging,
    scalapbJson,
    component("play-test")
  )

  val webknossosDatastoreDependencies = Seq(
    akkaLogging
  )

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
    specs2 % Test) ++ tiff ++ mturk

}
