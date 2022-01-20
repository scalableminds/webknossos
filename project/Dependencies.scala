import play.sbt.PlayImport._
import sbt._

object Dependencies {
  private val akkaVersion = "2.6.14"
  private val akkaHttpVersion = "10.2.6"
  private val log4jVersion = "2.17.0"
  private val webknossosWrapVersion = "1.1.15"

  private val akkaLogging = "com.typesafe.akka" %% "akka-slf4j" % akkaVersion
  private val akkaTest = "com.typesafe.akka" %% "akka-testkit" % akkaVersion
  private val akkaHttp = "com.typesafe.akka" %% "akka-http-core" % akkaHttpVersion
  private val commonsCodec = "commons-codec" % "commons-codec" % "1.10"
  private val commonsEmail = "org.apache.commons" % "commons-email" % "1.5"
  private val commonsIo = "commons-io" % "commons-io" % "2.9.0"
  private val commonsLang = "org.apache.commons" % "commons-lang3" % "3.1"
  private val gson = "com.google.code.gson" % "gson" % "1.7.1"
  private val grpc = "io.grpc" % "grpc-netty-shaded" % scalapb.compiler.Version.grpcJavaVersion
  private val grpcServices = "io.grpc" % "grpc-services" % scalapb.compiler.Version.grpcJavaVersion
  private val scalapbRuntime = "com.thesamet.scalapb" %% "scalapb-runtime" % scalapb.compiler.Version.scalapbVersion
  private val scalapbRuntimeGrpc = "com.thesamet.scalapb" %% "scalapb-runtime-grpc" % scalapb.compiler.Version.scalapbVersion
  private val liftCommon = "net.liftweb" %% "lift-common" % "3.0.2"
  private val liftUtil = "net.liftweb" %% "lift-util" % "3.0.2"
  private val log4jApi = "org.apache.logging.log4j" % "log4j-core" % log4jVersion % Provided
  private val log4jCore = "org.apache.logging.log4j" % "log4j-api" % log4jVersion % Provided
  private val playFramework = "com.typesafe.play" %% "play" % "2.8.8"
  private val playJson = "com.typesafe.play" %% "play-json" % "2.8.1"
  private val playIteratees = "com.typesafe.play" %% "play-iteratees" % "2.6.1"
  private val playIterateesStreams = "com.typesafe.play" %% "play-iteratees-reactive-streams" % "2.6.1"
  private val reactiveBson = "org.reactivemongo" %% "reactivemongo-bson" % "0.12.7"
  private val scalaAsync = "org.scala-lang.modules" %% "scala-async" % "0.9.7"
  private val scalaLogging = "com.typesafe.scala-logging" %% "scala-logging" % "3.5.0"
  private val scalaTestPlusPlay = "org.scalatestplus.play" %% "scalatestplus-play" % "5.1.0" % "test"
  private val silhouette = "com.mohiva" %% "play-silhouette" % "6.0.0"
  private val silhouetteTestkit = "com.mohiva" %% "play-silhouette-testkit" % "5.0.7" % "test"
  private val trireme = "io.apigee.trireme" % "trireme-core" % "0.9.3"
  private val triremeNode = "io.apigee.trireme" % "trireme-node12src" % "0.9.3"
  private val webknossosWrap = "com.scalableminds" %% "webknossos-wrap" % webknossosWrapVersion
  private val xmlWriter = "org.glassfish.jaxb" % "txw2" % "2.2.11"
  private val woodstoxXml = "org.codehaus.woodstox" % "wstx-asl" % "3.2.3"
  private val redis = "net.debasishg" %% "redisclient" % "3.9"
  private val spire = "org.typelevel" %% "spire" % "0.14.1"
  private val jgrapht = "org.jgrapht" % "jgrapht-core" % "1.4.0"
  private val swagger = "io.swagger" %% "swagger-play2" % "1.7.1"
  private val jhdf = "cisd" % "jhdf5" % "19.04.0"

  private val sql = Seq(
    "com.typesafe.slick" %% "slick" % "3.2.3",
    "com.typesafe.slick" %% "slick-hikaricp" % "3.2.3",
    "com.typesafe.slick" %% "slick-codegen" % "3.2.3",
    "org.postgresql" % "postgresql" % "42.2.20"
  )

  val utilDependencies: Seq[ModuleID] = Seq(
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

  val webknossosDatastoreDependencies: Seq[ModuleID] = Seq(
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
    swagger,
    spire,
    akkaHttp,
    redis,
    jhdf
  )

  val webknossosTracingstoreDependencies: Seq[ModuleID] = Seq(
    jgrapht
  )

  val webknossosDependencies: Seq[ModuleID] = Seq(
    akkaTest,
    commonsCodec,
    scalaAsync,
    scalaTestPlusPlay,
    silhouette,
    silhouetteTestkit,
    specs2 % Test,
    trireme,
    triremeNode,
    xmlWriter,
    woodstoxXml
  ) ++ sql

}
