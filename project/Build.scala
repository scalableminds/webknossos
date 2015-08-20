import sbt._
import sbt.Keys._
import play.Project._
import sbt.Task
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

object Dependencies{
  val braingamesVersion = "6.9.29-master-fix"

  val braingamesDataStore = "com.scalableminds" %% "braingames-datastore" % braingamesVersion
}

object Resolvers {
  val scmRel = Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns)
  val scmIntRel = "scm.io intern releases repo" at "http://maven.scm.io/releases/"
  val scmIntSnaps = "scm.io intern snapshots repo" at "http://maven.scm.io/snapshots/"
}

object ApplicationBuild extends Build {
  import Dependencies._
  import Resolvers._

  lazy val datastoreSettings = Seq(
    scalaVersion := "2.10.3",
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

