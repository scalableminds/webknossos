import sbt._

object DependencyResolvers {
  val atlassian = "Atlassian Releases" at "https://maven.atlassian.com/public/"
  val sciJava = "SciJava Public" at "https://maven.scijava.org/content/repositories/public/"

  val dependencyResolvers = Seq(
    Resolver.sonatypeRepo("releases"),
    Resolver.sonatypeRepo("snapshots"),
    Resolver.typesafeRepo("releases"),
    sciJava,
    atlassian
  )
}
