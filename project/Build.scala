import sbt._
import sbt.Keys._
import sbt.Task
import sbtassembly.PathList
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global
import play.sbt.routes.RoutesKeys._

object Dependencies{
  val braingamesVersion = "10.1.1"

  val braingamesDataStore = "com.scalableminds" %% "braingames-datastore" % braingamesVersion

  val dependencies = Seq(
    braingamesDataStore,
    "com.typesafe.akka" %% "akka-slf4j" % "2.4.1")
}

object Resolvers {
  val scmRel = "scm.io releases S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/releases/"
  val scmSnaps = "scm.io snapshots S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/snapshots/"
}

object ApplicationBuild extends Build with sbtassembly.AssemblyKeys {
  import Dependencies._
  import Resolvers._
  import sbtassembly.MergeStrategy


  lazy val datastoreSettings = Seq(
    version := braingamesVersion,
    libraryDependencies ++= dependencies,
    scalaVersion := "2.11.7",
      resolvers ++= Seq(
      scmRel,
      scmSnaps
    ),
    routesGenerator := InjectedRoutesGenerator,
    assemblyMergeStrategy in assembly := {
      case "application.conf"                                                  => MergeStrategy.concat
      case "package-info.class"                                                => MergeStrategy.concat
      case PathList(ps @ _*) if ps.last endsWith "package-info.class"          => MergeStrategy.discard
      case PathList(ps @ _*) if ps.last endsWith "pom.properties"              => MergeStrategy.concat
      case PathList(ps @ _*) if ps.last endsWith "pom.xml"                     => MergeStrategy.discard
      case PathList(ps @ _*) if ps.last endsWith "log4j-provider.properties"   => MergeStrategy.last
      case x if x.startsWith("META-INF/ECLIPSEF.RSA")                          => MergeStrategy.last
      case x if x.startsWith("META-INF/mailcap")                               => MergeStrategy.last
      case x if x.startsWith("META-INF/mimetypes.default")                     => MergeStrategy.last
      case x if x.startsWith("plugin.properties")                              => MergeStrategy.last
      case PathList("javax", "servlet", xs @ _*)                               => MergeStrategy.first
      case PathList("javax", "transaction", xs @ _*)                           => MergeStrategy.first
      case PathList("javax", "mail", xs @ _*)                                  => MergeStrategy.first
      case PathList("javax", "activation", xs @ _*)                            => MergeStrategy.first
      case PathList(ps @ _*) if ps.last endsWith ".html"                       => MergeStrategy.first
      case PathList("org", "apache", "commons", "logging", xs @ _*)            => MergeStrategy.first
      case PathList("play", "core", "server", xs @ _*)                         => MergeStrategy.first
      case "log4j.properties"                                                  => MergeStrategy.concat
      case "unwanted.txt"                                                      => MergeStrategy.discard
      case x =>
        val oldStrategy = (assemblyMergeStrategy in assembly).value
        oldStrategy(x)
    }
  )

  lazy val standaloneDatastore: Project = Project("standalone-datastore", file("."))
    .enablePlugins(play.PlayScala)
    .settings(datastoreSettings:_*)
}
