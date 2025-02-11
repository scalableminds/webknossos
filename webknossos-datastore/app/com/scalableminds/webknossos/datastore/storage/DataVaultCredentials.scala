package com.scalableminds.webknossos.datastore.storage

import play.api.libs.json.{JsValue, Json, OFormat}

sealed trait DataVaultCredential

object DataVaultCredential {
  implicit val jsonFormat: OFormat[DataVaultCredential] = Json.format[DataVaultCredential]
}

case class HttpBasicAuthCredential(name: String, username: String, password: String, user: String, organization: String)
    extends DataVaultCredential

object HttpBasicAuthCredential {
  implicit val jsonFormat: OFormat[HttpBasicAuthCredential] = Json.format[HttpBasicAuthCredential]
}

case class S3AccessKeyCredential(
    name: String,
    accessKeyId: String,
    secretAccessKey: String,
    user: String,
    organization: String
) extends DataVaultCredential

object S3AccessKeyCredential {
  implicit val jsonFormat: OFormat[S3AccessKeyCredential] = Json.format[S3AccessKeyCredential]
}

case class GoogleServiceAccountCredential(name: String, secretJson: JsValue, user: String, organization: String)
    extends DataVaultCredential

object GoogleServiceAccountCredential {
  implicit val jsonFormat: OFormat[GoogleServiceAccountCredential] = Json.format[GoogleServiceAccountCredential]
}

case class LegacyDataVaultCredential(user: String, password: Option[String]) extends DataVaultCredential {
  def toBasicAuth: HttpBasicAuthCredential =
    HttpBasicAuthCredential(name = "", username = user, password = password.getOrElse(""), user = "", organization = "")

  def toS3AccessKey: S3AccessKeyCredential =
    S3AccessKeyCredential(
      name = "",
      accessKeyId = user,
      secretAccessKey = password.getOrElse(""),
      user = "",
      organization = ""
    )
}

object LegacyDataVaultCredential {
  implicit val jsonFormat: OFormat[LegacyDataVaultCredential] = Json.format[LegacyDataVaultCredential]
}
