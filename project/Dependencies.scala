import play.sbt.Play.autoImport._
import sbt._


object Dependencies {
  val akkaVersion = "2.4.1"
  val log4jVersion = "2.0-beta9"
  val newrelicVersion = "3.44.1"
  val playVersion = "2.4.6"
  val reactivePlayVersion = "0.11.13-play24"
  val reactiveVersion = "0.11.13"
  val webknossosWrapVersion = "1.1.4"

  val airbrake = "com.scalableminds" %% "play-airbrake" % "0.5.0"
  val akkaAgent = "com.typesafe.akka" %% "akka-agent" % akkaVersion
  val akkaLogging = "com.typesafe.akka" %% "akka-slf4j" % akkaVersion
  val akkaRemote = "com.typesafe.akka" %% "akka-remote" % akkaVersion
  val akkaTest = "com.typesafe.akka" %% "akka-testkit" % akkaVersion
  val ceedubs = "net.ceedubs" %% "ficus" % "1.1.2"
  val commonsCodec = "commons-codec" % "commons-codec" % "1.10"
  val commonsEmail = "org.apache.commons" % "commons-email" % "1.3.1"
  val commonsIo = "commons-io" % "commons-io" % "2.4"
  val commonsLang = "org.apache.commons" % "commons-lang3" % "3.1"
  val liftBox = "net.liftweb" % "lift-common_2.10" % "2.6-M3"
  val liftUtil = "net.liftweb" % "lift-util_2.10" % "3.0-M1"
  val log4jApi = "org.apache.logging.log4j" % "log4j-core" % log4jVersion
  val log4jCore =  "org.apache.logging.log4j" % "log4j-api" % log4jVersion
  val newrelic = "com.newrelic.agent.java" % "newrelic-agent" % newrelicVersion
  val newrelicApi = "com.newrelic.agent.java" % "newrelic-api" % newrelicVersion
  val playFramework = "com.typesafe.play" %% "play" % playVersion
  val reactiveBson = "org.reactivemongo" %% "reactivemongo-bson-macros" % reactiveVersion
  val reactivePlay = "org.reactivemongo" %% "play2-reactivemongo" % reactivePlayVersion
  val rocksDB = "org.rocksdb" % "rocksdbjni" % "5.1.2"
  val scalaAsync = "org.scala-lang.modules" %% "scala-async" % "0.9.2"
  val scalaLogging = "com.typesafe.scala-logging" %% "scala-logging" % "3.4.0"
  val scalapbJson = "com.scalableminds" %% "scalapb-json4s" % "0.3.2.0-scm"
  val silhouette = "com.mohiva" %% "play-silhouette" % "3.0.5"
  val silhouetteTestkit = "com.mohiva" %% "play-silhouette-testkit" % "3.0.5" % "test"
  val urlHelper = "com.netaporter" %% "scala-uri" % "0.4.14"
  val webknossosWrap = "com.scalableminds" %% "webknossos-wrap" % webknossosWrapVersion
  val xmlWriter = "org.glassfish.jaxb" % "txw2" % "2.2.11"

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


  val utilDependencies = Seq(
    akkaAgent,
    akkaRemote,
    commonsEmail,
    commonsIo,
    commonsLang,
    liftBox,
    liftUtil,
    log4jApi,
    log4jCore,
    playFramework,
    reactiveBson,
    reactivePlay,
    scalaLogging,
    scalapbJson,
    ws
  )

  val webknossosDatastoreDependencies = Seq(
    akkaLogging,
    cache,
    newrelic,
    newrelicApi,
    rocksDB,
    webknossosWrap,
    component("play-test")
  )

  val webknossosDependencies = Seq(
    airbrake,
    akkaTest,
    ceedubs,
    commonsCodec,
    scalaAsync,
    silhouette,
    silhouetteTestkit,
    specs2 % Test,
    urlHelper,
    xmlWriter) ++ mturk

}
