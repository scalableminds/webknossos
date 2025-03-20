import sbt.Keys.{name, sbtVersion, scalaVersion}
import sbtbuildinfo.BuildInfoPlugin.autoImport.*

import scala.language.postfixOps
import scala.sys.process.*
import scala.util.Properties

object BuildInfoSettings {

  def getStdoutFromCommand(command: String, failureMsg: String): String =
    try {
      (command !!).trim
    } catch {
      case _: Throwable => failureMsg
    }

  val ciBuild: String = Properties.envOrElse("CIRCLE_BUILD_NUM", "")
  val ciTag: String = Properties.envOrElse("CIRCLE_TAG", "")

  def commitHash: String = getStdoutFromCommand("git rev-parse HEAD", "<getting commit hash failed>")
  def commitDate: String = getStdoutFromCommand("git log -1 --format=%cd ", "<getting git date failed>")

  def webknossosVersion: String = if (ciTag != "") ciTag else (if (ciBuild != "") ciBuild else "dev")

  val certificatePublicKey: Option[String] = Properties.envOrNone("CERTIFICATE_PUBLIC_KEY")

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
      "datastoreApiVersion" -> "2.0",
      "certificatePublicKey" -> certificatePublicKey
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
