resolvers += "Web plugin repo" at "http://siasia.github.com/maven2"    

//Following means libraryDependencies += "com.github.siasia" %% "xsbt-web-plugin" % "0.1.1-<sbt version>""
//libraryDependencies <+= sbtVersion(v => "com.github.siasia" %% "xsbt-web-plugin" % ("0.1.1-"+v))
addSbtPlugin("com.github.siasia" % "xsbt-web-plugin" % "0.1.2")
