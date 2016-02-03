import sbt._
import sbt.Keys._
import play.Project._
import sbt.Task
import sbtassembly.PathList
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

object Dependencies{
  val braingamesVersion = "6.10.16-master-fix"

  val braingamesDataStore = "com.scalableminds" %% "braingames-datastore" % braingamesVersion
}

object Resolvers {
  val scmRel = Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns)
  val scmIntRel = "scm.io intern releases repo" at "http://maven.scm.io/releases/"
  val scmIntSnaps = "scm.io intern snapshots repo" at "http://maven.scm.io/snapshots/"
}

object ApplicationBuild extends Build with sbtassembly.AssemblyKeys {
  import Dependencies._
  import Resolvers._
  import sbtassembly.MergeStrategy


  lazy val datastoreSettings = Seq(
    scalaVersion := "2.10.3",
      resolvers ++= Seq(
      scmRel,
      scmIntRel,
      scmIntSnaps
    ),
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

  lazy val standaloneDatastore: Project = play.Project(
    "standalone-datastore", 
    braingamesVersion, 
    dependencies = Seq(braingamesDataStore), 
    settings = datastoreSettings)
}

