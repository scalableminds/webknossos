package braingames.stackrenderer

import play.api.Configuration

case class S3Config(
  accessKey: String,
  secretKey: String,
  bucketName: String,
  branchName: String,
  isEnabled: Boolean = true)

object S3Config {
  def defaultDisabled =
    S3Config("", "", "", "", false)

  def fromConfig(config: Configuration) = {
    for {
      accessKey <- config.getString("AWS_ACCESS_KEY")
      secretKey <- config.getString("AWS_SECRET_KEY")
      bucketName <- config.getString("S3.bucket.name")
      isEnabled <- config.getBoolean("S3.isEnabled")
    } yield S3Config(accessKey,
      secretKey,
      bucketName,
      Option(System.getProperty("branchname")) orElse config.getString("branchname") getOrElse "development",
      isEnabled)
  }
}