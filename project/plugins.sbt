resolvers ++= Seq(
    DefaultMavenRepository,
    "Typesafe Repository" at "http://repo.typesafe.com/typesafe/releases/",
    Resolver.url("Scalableminds REL Repo", url("http://scalableminds.github.com/releases/"))(Resolver.ivyStylePatterns),
    Resolver.sftp("scm.io intern releases repo", "scm.io", 44144, "/srv/maven/releases/") as("maven", "5MwEuHWH6tRPL6yfNadQ")
)

addSbtPlugin("play" % "sbt-plugin" % "2.1.2-SCM.2")

addSbtPlugin("com.github.mpeltonen" % "sbt-idea" % "1.5.1")
