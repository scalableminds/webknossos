package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.Fox
import play.api.libs.json.{JsValue, Json, OFormat}

import scala.concurrent.ExecutionContext

sealed trait DataVaultCredential {
  def userId: Option[String]
  def organization: Option[String]
  def name: String

  private def isScopedToUserAndOrga: Boolean = userId.isDefined && organization.isDefined
  def assertScopedToUserAndOrga(implicit ec: ExecutionContext): Fox[Unit] =
   Fox.fromBool(isScopedToUserAndOrga) ?~> "stored credentials must be scoped to user and organization"
}

object DataVaultCredential {
  implicit val jsonFormat: OFormat[DataVaultCredential] = Json.format[DataVaultCredential]
}

case class HttpBasicAuthCredential(name: String,
                                   username: String,
                                   password: String,
                                   user: Option[String],
                                   organization: Option[String])
    extends DataVaultCredential {
  override def userId: Option[String] = user
}

object HttpBasicAuthCredential {
  implicit val jsonFormat: OFormat[HttpBasicAuthCredential] = Json.format[HttpBasicAuthCredential]
}

case class S3AccessKeyCredential(name: String,
                                 accessKeyId: String,
                                 secretAccessKey: String,
                                 user: Option[String],
                                 organization: Option[String])
    extends DataVaultCredential {
  override def userId: Option[String] = user
}

object S3AccessKeyCredential {
  implicit val jsonFormat: OFormat[S3AccessKeyCredential] = Json.format[S3AccessKeyCredential]
}

case class GoogleServiceAccountCredential(name: String,
                                          secretJson: JsValue,
                                          user: Option[String],
                                          organization: Option[String])
    extends DataVaultCredential {
  override def userId: Option[String] = user
}

object GoogleServiceAccountCredential {
  implicit val jsonFormat: OFormat[GoogleServiceAccountCredential] = Json.format[GoogleServiceAccountCredential]
}

case class LegacyDataVaultCredential(user: String, password: Option[String]) extends DataVaultCredential {
  def toBasicAuth: HttpBasicAuthCredential =
    HttpBasicAuthCredential(name = "",
                            username = user,
                            password = password.getOrElse(""),
                            user = Some(""),
                            organization = Some(""))

  def toS3AccessKey: S3AccessKeyCredential =
    S3AccessKeyCredential(name = "",
                          accessKeyId = user,
                          secretAccessKey = password.getOrElse(""),
                          user = Some(""),
                          organization = Some(""))

  override def name: String = ""
  override def userId: Option[String] = Some("")
  override def organization: Option[String] = Some("")
}

object LegacyDataVaultCredential {
  implicit val jsonFormat: OFormat[LegacyDataVaultCredential] = Json.format[LegacyDataVaultCredential]
}
