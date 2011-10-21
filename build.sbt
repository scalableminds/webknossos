// Set the project name to the string
name := "Scalable Minds Brainflight"

// The := method used in Name and Version is one of two fundamental methods.
// The other method is <<=
// All other initialization methods are implemented in terms of these.
version := "0.1"

scalaVersion := "2.9.1"

seq(webSettings :_*)

jettyScanDirs := Nil 

checksums := Nil

// Add a single dependency
libraryDependencies += "junit" % "junit" % "4.8" % "test"

// Add multiple dependencies
libraryDependencies ++= {
val liftVersion = "2.4-M4" // Put the current/latest lift version here
val jettyVersion = "8.0.3.v20111011"
Seq(
    "net.databinder" %% "dispatch-google" % "0.7.8",
    "net.databinder" %% "dispatch-meetup" % "0.7.8", 
    "net.liftweb" %% "lift-webkit" % liftVersion % "compile->default" withSources(),
    "net.liftweb" %% "lift-mapper" % liftVersion % "compile->default",
    "net.liftweb" %% "lift-wizard" % liftVersion % "compile->default",
    "org.eclipse.jetty" % "jetty-webapp" % jettyVersion % "compile->default;jetty",
    "org.eclipse.jetty" % "jetty-servlets" % jettyVersion % "jetty",
    "ch.qos.logback" % "logback-classic" % "0.9.26",
    "org.scala-tools.testing" %% "specs" % "1.6.9",
	"com.foursquare" %% "rogue" % "1.0.26" intransitive(),
	"net.liftweb"    %% "lift-mongodb-record" % liftVersion,
	"net.liftweb"    %% "lift-mongodb" % liftVersion 
)}



// Exclude backup files by default.  This uses ~=, which accepts a function of
// type T => T (here T = FileFilter) that is applied to the existing value.
// A similar idea is overriding a member and applying a function to the super value:
// override lazy val defaultExcludes = f(super.defaultExcludes)
// defaultExcludes ~= (filter => filter || "*~")
// Some equivalent ways of writing this:
// defaultExcludes ~= (_ || "*~")
// defaultExcludes ~= ( (_: FileFilter) || "*~")
// defaultExcludes ~= ( (filter: FileFilter) => filter || "*~")

resolvers += ScalaToolsSnapshots

resolvers += ScalaToolsReleases
