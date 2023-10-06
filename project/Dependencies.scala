import play.sbt.PlayImport._
import sbt._

object Dependencies {
  private val webknossosWrapVersion = "1.1.23"
  private val silhouetteVersion = "7.0.7"

  // Asynchronous caching. import com.github.benmanes.caffeine
  private val caffeine = "com.github.ben-manes.caffeine" % "caffeine" % "3.1.8"
  // Base64, Hashing. import org.apache.commons.codec
  private val commonsCodec = "commons-codec" % "commons-codec" % "1.16.0"
  // Sending emails. import org.apache.commons.mail
  private val commonsEmail = "org.apache.commons" % "commons-email" % "1.5"
  // File utils. import org.apache.commons.io
  private val commonsIo = "commons-io" % "commons-io" % "2.9.0"
  // HashCodeBuilder. import org.apache.commons.lang3
  private val commonsLang = "org.apache.commons" % "commons-lang3" % "3.12.0"
  // Streaming JSON parsing. import com.google.gson
  private val gson = "com.google.code.gson" % "gson" % "2.10.1"
  // Protocol buffers. import scalapb
  private val scalapbRuntime = "com.thesamet.scalapb" %% "scalapb-runtime" % scalapb.compiler.Version.scalapbVersion
  // Protocol buffer GRPC calls. Communication to FossilDB. import scalapb.grpc
  private val scalapbRuntimeGrpc = "com.thesamet.scalapb" %% "scalapb-runtime-grpc" % scalapb.compiler.Version.scalapbVersion
  // Protocol buffer GRPC calls. Communication to FossilDB. import io.grpc
  private val grpc = "io.grpc" % "grpc-netty-shaded" % scalapb.compiler.Version.grpcJavaVersion
  // Protocol buffer GRPC health check for FossilDB. import io.grpc
  private val grpcServices = "io.grpc" % "grpc-services" % scalapb.compiler.Version.grpcJavaVersion
  // Box/Tryo. import net.liftweb
  private val liftCommon = "net.liftweb" %% "lift-common" % "3.5.0"
  // Play Web Framework. import play
  private val playFramework = "com.typesafe.play" %% "play" % "2.9.0-RC3"
  // Play’s JSON serialization. import play.api.libs.json
  private val playJson = "com.typesafe.play" %% "play-json" % "2.10.1"
  private val reactiveBson = "org.reactivemongo" %% "reactivemongo-bson-api" % "1.0.10"
  private val scalaLogging = "com.typesafe.scala-logging" %% "scala-logging" % "3.9.5"
  private val scalaTestPlusPlay = "org.scalatestplus.play" %% "scalatestplus-play" % "5.1.0" % "test"
  private val silhouette = "io.github.honeycomb-cheesecake" %% "play-silhouette" % silhouetteVersion
  private val silhouetteTestkit = "io.github.honeycomb-cheesecake" %% "play-silhouette-testkit" % silhouetteVersion % "test"
  private val silhouetteCrypto = "io.github.honeycomb-cheesecake" %% "play-silhouette-crypto-jca" % silhouetteVersion
  private val webknossosWrap = "com.scalableminds" %% "webknossos-wrap" % "1.1.23"
  private val xmlWriter = "org.glassfish.jaxb" % "txw2" % "2.2.11"
  private val woodstoxXml = "org.codehaus.woodstox" % "wstx-asl" % "3.2.3"
  private val redis = "net.debasishg" %% "redisclient" % "3.42"
  private val spire = "org.typelevel" %% "spire" % "0.17.0"
  private val jgrapht = "org.jgrapht" % "jgrapht-core" % "1.4.0"
  private val jhdf = "cisd" % "jhdf5" % "19.04.0"
  private val ucarCdm = "edu.ucar" % "cdm-core" % "5.3.3"
  private val jodaTime = "joda-time" % "joda-time" % "2.12.5"
  private val jblosc = "org.lasersonlab" % "jblosc" % "1.0.1"
  private val guava = "com.google.guava" % "guava" % "18.0"
  private val awsS3 = "com.amazonaws" % "aws-java-sdk-s3" % "1.12.288"
  private val tika = "org.apache.tika" % "tika-core" % "1.5"
  private val jackson = "com.fasterxml.jackson.module" %% "jackson-module-scala" % "2.14.2"
  private val commonsCompress = "org.apache.commons" % "commons-compress" % "1.21"
  private val jwt = "com.github.jwt-scala" %% "jwt-play-json" % "9.1.1"
  private val googleCloudStorage = "com.google.cloud" % "google-cloud-storage" % "2.13.1"
  private val googleCloudStorageNio = "com.google.cloud" % "google-cloud-nio" % "0.123.28"
  private val brotli4j = "com.aayushatharva.brotli4j" % "brotli4j" % "1.11.0"
  private val brotli4jLinuxX86 = brotli4j.withName("native-linux-x86_64")
  private val brotli4cOsXX86 = brotli4j.withName("native-osx-x86_64")
  private val brotli4cOsXArm = brotli4j.withName("native-osx-aarch64")
  private val zstdJni = "com.github.luben" % "zstd-jni" % "1.5.5-5"
  private val bcrypt = "at.favre.lib" % "bcrypt" % "0.10.2"

  // For swagger annotations
  private val swaggerCore = "io.swagger" % "swagger-core" % "1.6.11"
  private val swaggerScala = "io.swagger" %% "swagger-scala-module" % "1.0.6"
  private val playRoutesCompiler = "com.typesafe.play" %% "routes-compiler" % "2.8.16"

  private val sql = Seq(
    "com.typesafe.slick" %% "slick" % "3.4.1",
    "com.typesafe.slick" %% "slick-hikaricp" % "3.4.1",
    "com.typesafe.slick" %% "slick-codegen" % "3.4.1",
    "org.postgresql" % "postgresql" % "42.5.2"
  )

  val utilDependencies: Seq[ModuleID] = Seq(
    commonsEmail,
    commonsIo,
    commonsLang,
    liftCommon,
    jodaTime,
    playJson,
    playFramework,
    reactiveBson,
    scalapbRuntime,
    scalaLogging,
    caffeine,
    // akkaCaching,
    bcrypt
  )

  val dependencyOverrides: Seq[ModuleID] = Seq(
    // liftweb-commons (used by us for Box/tryo) depends on older scala-xml, but we do not use its xml-related features
    "org.scala-lang.modules" % "scala-xml_2.13" % "2.2.0"
  )

  val webknossosDatastoreDependencies: Seq[ModuleID] = Seq(
    grpc,
    grpcServices,
    scalapbRuntimeGrpc,
    ehcache,
    gson,
    webknossosWrap,
    filters,
    ws,
    guice,
    swaggerCore,
    swaggerScala,
    playRoutesCompiler,
    spire,
    redis,
    jhdf,
    ucarCdm,
    jackson,
    guava,
    awsS3,
    tika,
    jblosc,
    commonsCompress,
    googleCloudStorage,
    googleCloudStorageNio,
    brotli4j,
    brotli4jLinuxX86,
    brotli4cOsXX86,
    brotli4cOsXArm,
    zstdJni
  )

  val webknossosTracingstoreDependencies: Seq[ModuleID] = Seq(
    jgrapht
  )

  val webknossosDependencies: Seq[ModuleID] = Seq(
    commonsCodec,
    scalaTestPlusPlay,
    silhouette,
    silhouetteTestkit,
    silhouetteCrypto,
    specs2 % Test,
    xmlWriter,
    woodstoxXml,
    jwt
  ) ++ sql

}
