// Set the project name to the string
name := "Scalable Minds Brainflight"

// The := method used in Name and Version is one of two fundamental methods.
// The other method is <<=
// All other initialization methods are implemented in terms of these.
version := "0.1"

scalaVersion := "2.8.1"

seq(webSettings :_*)

jettyScanDirs := Nil 

checksums := Nil

// Add a single dependency
libraryDependencies += "junit" % "junit" % "4.8" % "test"

// Add multiple dependencies
libraryDependencies ++= {
val liftVersion = "2.3" // Put the current/latest lift version here
Seq(
    "net.databinder" %% "dispatch-google" % "0.7.8",
    "net.databinder" %% "dispatch-meetup" % "0.7.8", 
    "net.liftweb" %% "lift-webkit" % liftVersion % "compile->default" withSources(),
    "net.liftweb" %% "lift-mapper" % liftVersion % "compile->default",
    "net.liftweb" %% "lift-wizard" % liftVersion % "compile->default",
    "org.eclipse.jetty" % "jetty-webapp" % "7.5.1.v20110908" % "compile->default;jetty",
    "ch.qos.logback" % "logback-classic" % "0.9.26"//,
   // "org.scala-tools.testing" %% "specs" % "1.6.9"
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
