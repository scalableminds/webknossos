import sbt._

object DependencyResolvers {
  val scmRel = "scm.io releases S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/releases/"
  val scmSnaps = "scm.io snapshots S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/snapshots/"
  val teamon = "teamon.eu repo" at "http://repo.teamon.eu"
  val atlassian = "Atlassian Releases" at "https://maven.atlassian.com/public/"

  val dependencyResolvers = Seq(
    Resolver.sonatypeRepo("releases"),
    Resolver.sonatypeRepo("snapshots"),
    Resolver.typesafeRepo("releases"),
    scmRel,
    scmSnaps,
    Resolver.bintrayRepo("scalaz", "releases"),
    teamon,
    atlassian
  )
}
