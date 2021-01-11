import play.sbt.PlayImport._
import sbt._

object Dependencies {
  val akkaVersion = "2.5.22"
  val log4jVersion = "2.13.3"
  val webknossosWrapVersion = "1.1.9"

  val akkaAgent = "com.typesafe.akka" %% "akka-agent" % akkaVersion
  val akkaLogging = "com.typesafe.akka" %% "akka-slf4j" % akkaVersion
  val akkaTest = "com.typesafe.akka" %% "akka-testkit" % akkaVersion
  val commonsCodec = "commons-codec" % "commons-codec" % "1.10"
  val commonsEmail = "org.apache.commons" % "commons-email" % "1.3.1"
  val commonsIo = "commons-io" % "commons-io" % "2.4"
  val commonsLang = "org.apache.commons" % "commons-lang3" % "3.1"
  val gson = "com.google.code.gson" % "gson" % "1.7.1"
  val grpc = "io.grpc" % "grpc-netty-shaded" % scalapb.compiler.Version.grpcJavaVersion
  val grpcServices = "io.grpc" % "grpc-services" % scalapb.compiler.Version.grpcJavaVersion
  val scalapbRuntime = "com.thesamet.scalapb" %% "scalapb-runtime" % scalapb.compiler.Version.scalapbVersion
  val scalapbRuntimeGrpc = "com.thesamet.scalapb" %% "scalapb-runtime-grpc" % scalapb.compiler.Version.scalapbVersion
  val liftCommon = "net.liftweb" %% "lift-common" % "3.0.2"
  val liftUtil = "net.liftweb" %% "lift-util" % "3.0.2"
  val log4jApi = "org.apache.logging.log4j" % "log4j-core" % log4jVersion % Provided
  val log4jCore = "org.apache.logging.log4j" % "log4j-api" % log4jVersion % Provided
  val playFramework = "com.typesafe.play" %% "play" % "2.7.1"
  val playJson = "com.typesafe.play" %% "play-json" % "2.7.2"
  val playIteratees = "com.typesafe.play" %% "play-iteratees" % "2.6.1"
  val playIterateesStreams = "com.typesafe.play" %% "play-iteratees-reactive-streams" % "2.6.1"
  val reactiveBson = "org.reactivemongo" %% "reactivemongo-bson" % "0.12.7"
  val scalaAsync = "org.scala-lang.modules" %% "scala-async" % "0.9.7"
  val scalaLogging = "com.typesafe.scala-logging" %% "scala-logging" % "3.5.0"
  val scalaTest = "org.scalatest" %% "scalatest" % "3.0.5" % "test"
  val scalaTestPlusPlay = "org.scalatestplus.play" %% "scalatestplus-play" % "3.1.2" % "test"
  val silhouette = "com.mohiva" %% "play-silhouette" % "6.0.0"
  val silhouetteTestkit = "com.mohiva" %% "play-silhouette-testkit" % "5.0.7" % "test"
  val trireme = "io.apigee.trireme" % "trireme-core" % "0.9.3"
  val triremeNode = "io.apigee.trireme" % "trireme-node12src" % "0.9.3"
  val urlHelper = "com.netaporter" %% "scala-uri" % "0.4.16"
  val webknossosWrap = "com.scalableminds" %% "webknossos-wrap" % webknossosWrapVersion
  val xmlWriter = "org.glassfish.jaxb" % "txw2" % "2.2.11"
  val woodstoxXml = "org.codehaus.woodstox" % "wstx-asl" % "3.2.3"
  val redis = "net.debasishg" %% "redisclient" % "3.9"
  val spire = "org.typelevel" %% "spire" % "0.14.1"
  val jgrapht = "org.jgrapht" % "jgrapht-core" % "1.4.0"

  val sql = Seq(
    "com.typesafe.slick" %% "slick" % "3.2.3",
    "com.typesafe.slick" %% "slick-hikaricp" % "3.2.3",
    "com.typesafe.slick" %% "slick-codegen" % "3.2.3",
    "org.postgresql" % "postgresql" % "42.2.2"
  )

  val utilDependencies = Seq(
    akkaAgent,
    commonsEmail,
    commonsIo,
    commonsLang,
    liftCommon,
    liftUtil,
    log4jApi,
    log4jCore,
    playJson,
    playIteratees,
    playFramework,
    reactiveBson,
    scalapbRuntime,
    scalaLogging
  )

  val webknossosDatastoreDependencies = Seq(
    grpc,
    grpcServices,
    scalapbRuntimeGrpc,
    akkaLogging,
    ehcache,
    gson,
    webknossosWrap,
    playIterateesStreams,
    filters,
    ws,
    guice,
    spire
  )

  val webknossosTracingstoreDependencies = Seq(
    redis,
    jgrapht
  )

  val webknossosDependencies = Seq(
    akkaTest,
    commonsCodec,
    scalaAsync,
    scalaTest,
    scalaTestPlusPlay,
    silhouette,
    silhouetteTestkit,
    specs2 % Test,
    trireme,
    triremeNode,
    urlHelper,
    xmlWriter,
    woodstoxXml,
  ) ++ sql

}
