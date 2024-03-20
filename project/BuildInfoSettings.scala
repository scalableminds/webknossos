import scala.sys.process._
import sbt.Keys.{name, sbtVersion, scalaVersion}
import sbtbuildinfo.BuildInfoPlugin.autoImport._
import scala.language.postfixOps

object BuildInfoSettings {

  def getStdoutFromCommand(command: String, failureMsg: String): String =
    try {
      (command !!).trim
    } catch {
      case _: Throwable => failureMsg
    }

  val ciBuild: String =
    if (System.getenv().containsKey("CIRCLE_BUILD_NUM")) System.getenv().get("CIRCLE_BUILD_NUM") else ""
  val ciTag: String = if (System.getenv().containsKey("CIRCLE_TAG")) System.getenv().get("CIRCLE_TAG") else ""

  def commitHash: String = getStdoutFromCommand("git rev-parse HEAD", "<getting commit hash failed>")
  def commitDate: String = getStdoutFromCommand("git log -1 --format=%cd ", "<getting git date failed>")

  def webknossosVersion: String = if (ciTag != "") ciTag else (if (ciBuild != "") ciBuild else "dev")

  lazy val webknossosBuildInfoSettings = Seq(
    buildInfoKeys := Seq[BuildInfoKey](
      name,
      scalaVersion,
      sbtVersion,
      "commitHash" -> commitHash,
      "commitDate" -> commitDate,
      "ciBuild" -> ciBuild,
      "ciTag" -> ciTag,
      "version" -> webknossosVersion,
      "datastoreApiVersion" -> "2.0"
    ),
    buildInfoPackage := "webknossos",
    buildInfoOptions := Seq(BuildInfoOption.ToJson)
  )

  lazy val webknossosDatastoreBuildInfoSettings = Seq(
    buildInfoKeys := Seq[BuildInfoKey](
      name,
      scalaVersion,
      sbtVersion,
      "commitHash" -> commitHash,
      "commitDate" -> commitDate,
      "ciBuild" -> ciBuild,
      "ciTag" -> ciTag,
      "version" -> webknossosVersion,
      "datastoreApiVersion" -> "2.0"
    ),
    buildInfoPackage := "webknossosDatastore",
    buildInfoOptions := Seq(BuildInfoOption.ToJson)
  )

  lazy val webknossosTracingstoreBuildInfoSettings = Seq(
    buildInfoKeys := Seq[BuildInfoKey](name,
                                       scalaVersion,
                                       sbtVersion,
                                       "commitHash" -> commitHash,
                                       "commitDate" -> commitDate,
                                       "ciBuild" -> ciBuild,
                                       "ciTag" -> ciTag,
                                       "version" -> webknossosVersion),
    buildInfoPackage := "webknossosTracingstore",
    buildInfoOptions := Seq(BuildInfoOption.ToJson)
  )

}
