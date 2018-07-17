import sbt.Keys.{name, sbtVersion, scalaVersion, version}
import sbtbuildinfo.BuildInfoPlugin.autoImport._

object BuildInfoSettings {

  def commitHash = new java.lang.Object() {
    override def toString(): String = {
      try {
        val extracted = new java.io.InputStreamReader(java.lang.Runtime.getRuntime().exec("git rev-parse HEAD").getInputStream())
        (new java.io.BufferedReader(extracted)).readLine()
      } catch {
        case t: Throwable => "get git hash failed"
      }
    }
  }.toString()

  def commitDate = new java.lang.Object() {
    override def toString(): String = {
      try {
        val extracted = new java.io.InputStreamReader(java.lang.Runtime.getRuntime().exec("git log -1 --format=%cd ").getInputStream())
        (new java.io.BufferedReader(extracted)).readLine()

      } catch {
        case t: Throwable => "get git date failed"
      }
    }
  }.toString()

  val ciBuild = if (System.getenv().containsKey("CIRCLE_BUILD_NUM")) System.getenv().get("CIRCLE_BUILD_NUM") else "";
  val ciTag = if (System.getenv().containsKey("CIRCLE_TAG")) System.getenv().get("CIRCLE_TAG") else "";


  lazy val webknossosBuildInfoSettings = Seq(
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion,
      "commitHash" -> commitHash,
      "commitDate" -> commitDate,
      "ciBuild" -> ciBuild,
      "ciTag" -> ciTag
    ),
    buildInfoPackage := "webknossos",
    buildInfoOptions := Seq(BuildInfoOption.ToJson)
  )

  lazy val webknossosDatastoreBuildInfoSettings = Seq(
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion,
      "commitHash" -> commitHash,
      "commitDate" -> commitDate,
      "ciBuild" -> ciBuild,
      "ciTag" -> ciTag
    ),
    buildInfoPackage := "webknossosDatastore",
    buildInfoOptions := Seq(BuildInfoOption.ToJson)
  )

}
