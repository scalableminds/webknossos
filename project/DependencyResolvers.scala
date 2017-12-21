import sbt._

object DependencyResolvers {
  val novusRel = "repo.novus rels" at "http://repo.novus.com/releases/"
  val novuesSnaps = "repo.novus snaps" at "http://repo.novus.com/snapshots/"
  val sonaRels = "sonatype rels" at "https://oss.sonatype.org/content/repositories/releases/"
  val sonaSnaps = "sonatype snaps" at "https://oss.sonatype.org/content/repositories/snapshots/"
  val sgSnaps = "sgodbillon" at "https://bitbucket.org/sgodbillon/repository/raw/master/snapshots/"
  val typesafeRel = "typesafe" at "http://repo.typesafe.com/typesafe/releases"
  val scmRel = "scm.io releases S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/releases/"
  val scmRelGithub = Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns)
  val scmSnaps = "scm.io snapshots S3 bucket" at "https://s3-eu-central-1.amazonaws.com/maven.scm.io/snapshots/"
  val teamon = "teamon.eu repo" at "http://repo.teamon.eu"
  val bintray = "scalaz-bintray" at "http://dl.bintray.com/scalaz/releases"
  val atlassian = "Atlassian Releases" at "https://maven.atlassian.com/public/"

  val dependencyResolvers = Seq(
    novusRel,
    novuesSnaps,
    sonaRels,
    sonaSnaps,
    sgSnaps,
    typesafeRel,
    scmRel,
    scmRelGithub,
    scmSnaps,
    bintray,
    teamon,
    atlassian
  )
}
