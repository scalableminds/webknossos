package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.{AutoJsonFormat, Fox}
import play.api.libs.json.JsValue
import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}

import scala.concurrent.ExecutionContext

sealed trait DataVaultCredential derives AutoJsonFormat {
  def userId: Option[String]
  def organization: Option[String]
  def name: String

  private def isScopedToUserAndOrga: Boolean = userId.isDefined && organization.isDefined
  def assertScopedToUserAndOrga(implicit ec: ExecutionContext): Fox[Unit] =
    Fox.fromBool(isScopedToUserAndOrga) ?~> "stored credentials must be scoped to user and organization"
}

case class HttpBasicAuthCredential(
    name: String,
    username: String,
    password: String,
    user: Option[String],
    organization: Option[String]
) extends DataVaultCredential derives AutoJsonFormat {
  override def userId: Option[String] = user
}

case class XAuthTokenCredential(
    name: String,
    tokenValue: String,
    user: Option[String],
    organization: Option[String]
) extends DataVaultCredential derives AutoJsonFormat {
  override def userId: Option[String] = user
}

case class S3AccessKeyCredential(
    name: String,
    accessKeyId: String,
    secretAccessKey: String,
    user: Option[String],
    organization: Option[String]
) extends DataVaultCredential derives AutoJsonFormat {
  override def userId: Option[String] = user

  def toCredentialsProvider: StaticCredentialsProvider = StaticCredentialsProvider.create(
    AwsBasicCredentials.builder.accessKeyId(accessKeyId).secretAccessKey(secretAccessKey).build()
  )
}

case class GoogleServiceAccountCredential(
    name: String,
    secretJson: JsValue,
    user: Option[String],
    organization: Option[String]
) extends DataVaultCredential derives AutoJsonFormat {
  override def userId: Option[String] = user
}

case class LegacyDataVaultCredential(user: String, password: Option[String]) extends DataVaultCredential
    derives AutoJsonFormat {
  def toBasicAuth: HttpBasicAuthCredential =
    HttpBasicAuthCredential(
      name = "",
      username = user,
      password = password.getOrElse(""),
      user = Some(""),
      organization = Some("")
    )

  def toS3AccessKey: S3AccessKeyCredential =
    S3AccessKeyCredential(
      name = "",
      accessKeyId = user,
      secretAccessKey = password.getOrElse(""),
      user = Some(""),
      organization = Some("")
    )

  override def name: String = ""
  override def userId: Option[String] = Some("")
  override def organization: Option[String] = Some("")
}
