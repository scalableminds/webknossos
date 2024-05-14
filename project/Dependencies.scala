import play.sbt.PlayImport.{filters, _}
import sbt._

object Dependencies {
  private val silhouetteVersion = "10.0.0"
  private val brotliVersion = "1.16.0"
  private val scalapbVersion = scalapb.compiler.Version.scalapbVersion
  private val grpcVersion = scalapb.compiler.Version.grpcJavaVersion

  val utilDependencies: Seq[ModuleID] = Seq(
    // Play Web Framework. import play
    "org.playframework" %% "play" % "3.0.3",
    // Play’s JSON serialization. import play.api.libs.json
    "com.typesafe.play" %% "play-json" % "2.10.5",
    // Sending emails. import org.apache.commons.mail
    "org.apache.commons" % "commons-email" % "1.5",
    // File utils. import org.apache.commons.io
    "commons-io" % "commons-io" % "2.16.1",
    // HashCodeBuilder. import org.apache.commons.lang3
    "org.apache.commons" % "commons-lang3" % "3.14.0",
    // Box/Tryo. import net.liftweb
    "net.liftweb" %% "lift-common" % "3.5.0",
    // ObjectIds. import reactivemongo.api.bson
    "org.reactivemongo" %% "reactivemongo-bson-api" % "1.0.10",
    // Protocol buffers. import scalapb
    "com.thesamet.scalapb" %% "scalapb-runtime" % scalapbVersion,
    // LazyLogging. import com.typesafe.scalalogging
    "com.typesafe.scala-logging" %% "scala-logging" % "3.9.5",
    // Asynchronous caching. import com.github.benmanes.caffeine
    caffeine,
    // password hashing with bcrypt. import at.favre.lib.crypto.bcrypt
    "at.favre.lib" % "bcrypt" % "0.10.2",
    // Play http filters. Not imported.
    filters,
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
    // Play WS Http client, used for RPC calls. import play.api.libs.ws
    ws,
    // Dependency Injection. import javax.inject.Inject
    guice,
    // Handling of unsigned integer types. import spire
    "org.typelevel" %% "spire" % "0.18.0",
    // Redis database client. import com.redis
    "net.debasishg" %% "redisclient" % "3.42",
    // Read hdf5 files. import ch.systemsx.cisd.hdf5
    "cisd" % "jhdf5" % "19.04.1",
    // MultiArray (ndarray) handles. import ucar
    "edu.ucar" % "cdm-core" % "5.4.2",
    // Amazon S3 cloud storage client. import com.amazonaws
    "com.amazonaws" % "aws-java-sdk-s3" % "1.12.584",
    // Google cloud storage client. import com.google.cloud.storage, import com.google.auth.oauth2
    "com.google.cloud" % "google-cloud-storage" % "2.36.1",
    // Blosc compression. import org.blosc
    "org.lasersonlab" % "jblosc" % "1.0.1",
    // Zstd compression. import org.apache.commons.compress
    "org.apache.commons" % "commons-compress" % "1.26.1",
    // Zstd compression native bindings. not imported
    "com.github.luben" % "zstd-jni" % "1.5.5-5",
    // Brotli compression. import com.aayushatharva.brotli4j
    "com.aayushatharva.brotli4j" % "brotli4j" % brotliVersion,
    // Brotli compression native bindings. not imported
    "com.aayushatharva.brotli4j" % "native-linux-x86_64" % brotliVersion,
    "com.aayushatharva.brotli4j" % "native-osx-x86_64" % brotliVersion,
    "com.aayushatharva.brotli4j" % "native-osx-aarch64" % brotliVersion,
    // lz4 compression. import net.jpountz.lz4
    "org.lz4" % "lz4-java" % "1.8.0"
  )

  val webknossosTracingstoreDependencies: Seq[ModuleID] = Seq(
    // Graph algorithms. import org.jgrapht
    "org.jgrapht" % "jgrapht-core" % "1.5.2"
  )

  val webknossosDependencies: Seq[ModuleID] = Seq(
    // Base64, Hashing. import org.apache.commons.codec
    "commons-codec" % "commons-codec" % "1.16.0",
    // End-to-end tests, backend unit tests. import org.scalatestplus.play
    "org.scalatestplus.play" %% "scalatestplus-play" % "7.0.1" % "test",
    // Authenticated requests. import play.silhouette
    "org.playframework.silhouette" %% "play-silhouette" % silhouetteVersion,
    // Signing Cookies. import play.silhouette.crypto
    "org.playframework.silhouette" %% "play-silhouette-crypto-jca" % silhouetteVersion,
    // End-to-end test specs
    specs2 % Test,
    // Writing XML. import com.sun.xml.txw2
    "org.glassfish.jaxb" % "txw2" % "4.0.5",
    // Makes txw2 write self-closing tags in xml (which we want). Not imported.
    "org.codehaus.woodstox" % "wstx-asl" % "4.0.6",
    // Json Web Tokens (used for OIDC Auth). import pdi.jwt
    "com.github.jwt-scala" %% "jwt-play-json" % "10.0.0",
    // SQL Queries. import slick
    "com.typesafe.slick" %% "slick" % "3.5.0",
    // SQL Queries connection pool. not imported.
    "com.typesafe.slick" %% "slick-hikaricp" % "3.5.1",
    // SQL Queries class generation. Started with runner as slick.codegen.SourceCodeGenerator
    "com.typesafe.slick" %% "slick-codegen" % "3.5.1",
    // SQL Queries postgres specifics. not imported.
    "org.postgresql" % "postgresql" % "42.7.3"
  )

  val dependencyOverrides: Seq[ModuleID] = Seq(
    // liftweb-commons (used by us for Box/tryo) depends on older scala-xml, but we do not use its xml-related features
    "org.scala-lang.modules" % "scala-xml_2.13" % "2.2.0"
  )

}
