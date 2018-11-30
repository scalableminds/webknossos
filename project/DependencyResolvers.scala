import sbt._

object DependencyResolvers {
  val teamon = "teamon.eu repo" at "http://repo.teamon.eu"
  val atlassian = "Atlassian Releases" at "https://maven.atlassian.com/public/"

  val dependencyResolvers = Seq(
    Resolver.sonatypeRepo("releases"),
    Resolver.sonatypeRepo("snapshots"),
    Resolver.typesafeRepo("releases"),
    Resolver.bintrayRepo("scalaz", "releases"),
    teamon,
    atlassian
  )
}
