resolvers ++= Seq(
    DefaultMavenRepository,
    "Typesafe Repository" at "http://repo.typesafe.com/typesafe/releases/"
)

addSbtPlugin("play" % "sbt-plugin" % "2.1-SNAPSHOT")

addSbtPlugin("com.github.mpeltonen" % "sbt-idea" % "1.1.0-M1-TYPESAFE")