package com.scalableminds.webknossos.datastore.storage

import play.api.libs.json.{JsValue, Json, OFormat}

sealed trait FileSystemCredential

object FileSystemCredential {
  implicit val jsonFormat: OFormat[FileSystemCredential] = Json.format[FileSystemCredential]
}

case class HttpBasicAuthCredential(name: String, username: String, password: String, user: String, organization: String)
    extends FileSystemCredential

object HttpBasicAuthCredential {
  implicit val jsonFormat: OFormat[HttpBasicAuthCredential] = Json.format[HttpBasicAuthCredential]
}

case class S3AccessKeyCredential(name: String,
                                 accessKeyId: String,
                                 secretAccessKey: String,
                                 user: String,
                                 organization: String)
    extends FileSystemCredential

object S3AccessKeyCredential {
  implicit val jsonFormat: OFormat[S3AccessKeyCredential] = Json.format[S3AccessKeyCredential]
}

case class GoogleServiceAccountCredential(name: String, secretJson: JsValue, user: String, organization: String)
    extends FileSystemCredential

object GoogleServiceAccountCredential {
  implicit val jsonFormat: OFormat[GoogleServiceAccountCredential] = Json.format[GoogleServiceAccountCredential]
}

case class LegacyFileSystemCredential(user: String, password: Option[String]) extends FileSystemCredential {
  def toBasicAuth: HttpBasicAuthCredential =
    HttpBasicAuthCredential(name = "", username = user, password = password.getOrElse(""), user = "", organization = "")

  def toS3AccessKey: S3AccessKeyCredential =
    S3AccessKeyCredential(name = "",
                          accessKeyId = user,
                          secretAccessKey = password.getOrElse(""),
                          user = "",
                          organization = "")
}

object LegacyFileSystemCredential {
  implicit val jsonFormat: OFormat[LegacyFileSystemCredential] = Json.format[LegacyFileSystemCredential]
}
