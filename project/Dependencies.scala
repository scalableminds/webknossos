import play.sbt.PlayImport._
import sbt._

object Dependencies {
  private val silhouetteVersion = "7.0.7"
  private val brotliVersion = "1.11.0"
  private val scalapbVersion = scalapb.compiler.Version.scalapbVersion
  private val grpcVersion = scalapb.compiler.Version.grpcJavaVersion

  val utilDependencies: Seq[ModuleID] = Seq(
    // Play Web Framework. import play
    "com.typesafe.play" %% "play" % "2.9.0-RC3",
    // Play’s JSON serialization. import play.api.libs.json
    "com.typesafe.play" %% "play-json" % "2.10.1",
    // Sending emails. import org.apache.commons.mail
    "org.apache.commons" % "commons-email" % "1.5",
    // File utils. import org.apache.commons.io
    "commons-io" % "commons-io" % "2.9.0",
    // HashCodeBuilder. import org.apache.commons.lang3
    "org.apache.commons" % "commons-lang3" % "3.12.0",
    // Box/Tryo. import net.liftweb
    ("net.liftweb" %% "lift-common" % "3.5.0")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-parser-combinators_2.13"),
    // Datetime utils. import org.joda.time
    "joda-time" % "joda-time" % "2.12.5",
    // ObjectIds. import reactivemongo.api.bson
    ("org.reactivemongo" %% "reactivemongo-bson-api" % "1.0.10").cross(CrossVersion.for3Use2_13),
    // Protocol buffers. import scalapb
    "com.thesamet.scalapb" %% "scalapb-runtime" % scalapbVersion,
    // LazyLogging. import com.typesafe.scalalogging
    "com.typesafe.scala-logging" %% "scala-logging" % "3.9.5",
    // Asynchronous caching. import com.github.benmanes.caffeine
    caffeine,
    // password hashing with bcrypt. import at.favre.lib.crypto.bcrypt
    "at.favre.lib" % "bcrypt" % "0.10.2"
  )

  val webknossosDatastoreDependencies: Seq[ModuleID] = Seq(
    // Protocol buffer GRPC calls. Communication to FossilDB. import scalapb.grpc
    "com.thesamet.scalapb" %% "scalapb-runtime-grpc" % scalapbVersion,
    // Protocol buffer GRPC calls. Communication to FossilDB. import io.grpc
    "io.grpc" % "grpc-netty-shaded" % grpcVersion,
    // Protocol buffer GRPC health check for FossilDB. import io.grpc
    "io.grpc" % "grpc-services" % grpcVersion,
    // Streaming JSON parsing. import com.google.gson
    "com.google.code.gson" % "gson" % "2.10.1",
    // Reading wkw files. import com.scalableminds.webknossos.wrap
    ("com.scalableminds" %% "webknossos-wrap" % "1.1.23")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-parser-combinators_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13"),
    // Play http filters. Not imported.
    filters,
    // Play WS Http client, used for RPC calls. import play.api.libs.ws
    ws,
    // Dependency Injection. import javax.inject.Inject
    guice,
    // Handling of unsigned integer types. import spire
    ("org.typelevel" %% "spire" % "0.17.0")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-parser-combinators_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13"),
    // Redis database client. import com.redis
    ("net.debasishg" %% "redisclient" % "3.42")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-parser-combinators_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13"),
    // Read hdf5 files. import ch.systemsx.cisd.hdf5
    "cisd" % "jhdf5" % "19.04.1",
    // MultiArray (ndarray) handles. import ucar
    "edu.ucar" % "cdm-core" % "5.4.2",
    // Amazon S3 cloud storage client. import com.amazonaws
    "com.amazonaws" % "aws-java-sdk-s3" % "1.12.470",
    // Google cloud storage client. import com.google.cloud.storage, import com.google.auth.oauth2
    "com.google.cloud" % "google-cloud-storage" % "2.13.1",
    // Blosc compression. import org.blosc
    "org.lasersonlab" % "jblosc" % "1.0.1",
    // Zstd compression. import org.apache.commons.compress
    "org.apache.commons" % "commons-compress" % "1.21",
    // Zstd compression native bindings. not imported
    "com.github.luben" % "zstd-jni" % "1.5.5-5",
    // Brotli compression. import com.aayushatharva.brotli4j
    "com.aayushatharva.brotli4j" % "brotli4j" % brotliVersion,
    // Brotli compression native bindings. not imported
    "com.aayushatharva.brotli4j" % "native-linux-x86_64" % brotliVersion,
    "com.aayushatharva.brotli4j" % "native-osx-x86_64" % brotliVersion,
    "com.aayushatharva.brotli4j" % "native-osx-aarch64" % brotliVersion,
    // Swagger API descriptions. import io.swagger
    "io.swagger" % "swagger-core" % "1.6.11",
    // Swagger API annotations. import io.swagger.annotations
    ("io.swagger" %% "swagger-scala-module" % "1.0.6")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-parser-combinators_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13"),
    // Swagger API descriptions generated from play routes. import play.routes
    ("com.typesafe.play" %% "routes-compiler" % "2.8.16")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-parser-combinators_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13"),
  )

  val webknossosTracingstoreDependencies: Seq[ModuleID] = Seq(
    // Graph algorithms. import org.jgrapht
    "org.jgrapht" % "jgrapht-core" % "1.5.1"
  )

  val webknossosDependencies: Seq[ModuleID] = Seq(
    // Base64, Hashing. import org.apache.commons.codec
    "commons-codec" % "commons-codec" % "1.16.0",
    // End-to-end tests. import org.scalatestplus.play
    ("org.scalatestplus.play" %% "scalatestplus-play" % "5.1.0" % "test")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "play-ws_2.13")
      .exclude("com.typesafe.play", "play-functional_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone-xml_2.13")
      .exclude("com.typesafe.play", "play-streams_2.13")
      .exclude("com.typesafe.play", "play-json_2.13")
      .exclude("com.typesafe.play", "play_2.13")
      .exclude("com.typesafe.play", "play-cache_2.13")
      .exclude("com.typesafe.play", "play-server_2.13")
      .exclude("com.typesafe.play", "play-akka-http-server_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-test_2.13")
      .exclude("com.typesafe.play", "play-guice_2.13")
      .exclude("com.typesafe.play", "cachecontrol_2.13")
      .exclude("com.typesafe.play", "play-logback_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws_2.13"),
    // Authenticated requests. import com.mohiva.play.silhouette
    ("io.github.honeycomb-cheesecake" %% "play-silhouette" % silhouetteVersion)
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "play-ws_2.13")
      .exclude("com.typesafe.play", "play-functional_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone-xml_2.13")
      .exclude("com.typesafe.play", "play-streams_2.13")
      .exclude("com.typesafe.play", "play-json_2.13")
      .exclude("com.typesafe.play", "play_2.13")
      .exclude("com.typesafe.play", "play-cache_2.13")
      .exclude("com.typesafe.play", "play-server_2.13")
      .exclude("com.typesafe.play", "play-akka-http-server_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-test_2.13")
      .exclude("com.typesafe.play", "play-guice_2.13")
      .exclude("com.typesafe.play", "cachecontrol_2.13")
      .exclude("com.typesafe.play", "play-logback_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws_2.13"),
    // Signing Cookies. import com.mohiva.play.silhouette.crypto
    ("io.github.honeycomb-cheesecake" %% "play-silhouette-crypto-jca" % silhouetteVersion)
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "play-ws_2.13")
      .exclude("com.typesafe.play", "play-functional_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone-xml_2.13")
      .exclude("com.typesafe.play", "play-streams_2.13")
      .exclude("com.typesafe.play", "play-json_2.13")
      .exclude("com.typesafe.play", "play_2.13")
      .exclude("com.typesafe.play", "play-cache_2.13")
      .exclude("com.typesafe.play", "play-server_2.13")
      .exclude("com.typesafe.play", "play-akka-http-server_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-test_2.13")
      .exclude("com.typesafe.play", "play-guice_2.13")
      .exclude("com.typesafe.play", "cachecontrol_2.13")
      .exclude("com.typesafe.play", "play-logback_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws_2.13"),
    // End-to-end test specs
    specs2 % Test,
    // Writing XML. import com.sun.xml.txw2
    "org.glassfish.jaxb" % "txw2" % "4.0.2",
    // Makes txw2 write self-closing tags in xml (which we want). Not imported.
    "org.codehaus.woodstox" % "wstx-asl" % "4.0.6",
    // Json Web Tokens (used for OIDC Auth). import pdi.jwt
    ("com.github.jwt-scala" %% "jwt-play-json" % "9.2.0")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13")
      .exclude("com.typesafe.play", "play-ws_2.13")
      .exclude("com.typesafe.play", "play-functional_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone-xml_2.13")
      .exclude("com.typesafe.play", "play-streams_2.13")
      .exclude("com.typesafe.play", "play-json_2.13")
      .exclude("com.typesafe.play", "play_2.13")
      .exclude("com.typesafe.play", "play-cache_2.13")
      .exclude("com.typesafe.play", "play-server_2.13")
      .exclude("com.typesafe.play", "play-akka-http-server_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-test_2.13")
      .exclude("com.typesafe.play", "play-guice_2.13")
      .exclude("com.typesafe.play", "cachecontrol_2.13")
      .exclude("com.typesafe.play", "play-logback_2.13")
      .exclude("com.typesafe.play", "twirl-api_2.13")
      .exclude("com.typesafe.play", "play-ws-standalone_2.13")
      .exclude("com.typesafe.play", "play-ahc-ws_2.13"),
    // SQL Queries. import slick
    ("com.typesafe.slick" %% "slick" % "3.4.1")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13"),
    // SQL Queries connection pool. not imported.
    ("com.typesafe.slick" %% "slick-hikaricp" % "3.4.1")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13"),
    // SQL Queries class generation. Started with runner as slick.codegen.SourceCodeGenerator
    ("com.typesafe.slick" %% "slick-codegen" % "3.4.1")
      .cross(CrossVersion.for3Use2_13)
      .exclude("org.scala-lang.modules", "scala-xml_2.13")
      .exclude("org.scala-lang.modules", "scala-collection-compat_2.13"),
    // SQL Queries postgres specifics. not imported.
    "org.postgresql" % "postgresql" % "42.5.4"
  )

  val dependencyOverrides: Seq[ModuleID] = Seq(
    // liftweb-commons (used by us for Box/tryo) depends on older scala-xml, but we do not use its xml-related features
    ("org.scala-lang.modules" %% "scala-xml" % "2.2.0").cross(CrossVersion.for3Use2_13)
  )

}
