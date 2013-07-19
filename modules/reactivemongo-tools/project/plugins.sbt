resolvers += "Sonatype snapshots" at "http://oss.sonatype.org/content/repositories/snapshots/"

resolvers += "Sonatype releases"  at "https://oss.sonatype.org/content/repositories/releases/"

addSbtPlugin("com.typesafe.sbteclipse" % "sbteclipse-plugin" % "2.1.0")

addSbtPlugin("com.github.mpeltonen" % "sbt-idea" % "1.2.0-SNAPSHOT")
