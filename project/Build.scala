import sbt._
import sbt.Keys._
import play.Project._
import sbt.Task
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

object Dependencies{
  val braingamesVersion = "5.0.1-SNAPSHOT"

  val braingamesDataStore = "com.scalableminds" %% "braingames-datastore" % braingamesVersion
}

object Resolvers {
  val scmRel = Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns)
  val scmIntRel = Resolver.sftp("scm.io intern releases repo", "scm.io", 44144, "/srv/maven/releases/") as("maven", "5MwEuHWH6tRPL6yfNadQ")
  val scmIntSnaps = Resolver.sftp("scm.io intern snapshots repo", "scm.io", 44144, "/srv/maven/snapshots/") as("maven", "5MwEuHWH6tRPL6yfNadQ")
}

object ApplicationBuild extends Build {
  import Dependencies._
  import Resolvers._

  lazy val datastoreSettings = Seq(
    scalaVersion := "2.10.2",
      resolvers ++= Seq(
      scmRel,
      scmIntRel,
      scmIntSnaps
    )
  )

  lazy val standaloneDatastore: Project = play.Project(
    "standalone-datastore", 
    braingamesVersion, 
    dependencies = Seq(braingamesDataStore), 
    settings = datastoreSettings)
}

