package braingames.stackrenderer

import play.api.Configuration

case class S3Config(accessKey: String, secretKey: String, bucketName: String, branchName: String = "")

object S3Config {
  def fromConfig(config: Configuration) = {
    for {accessKey <- config.getString("AWS_ACCESS_KEY")
         secretKey <- config.getString("AWS_SECRET_KEY")
         bucketName <- config.getString("S3.bucket.name")}
    yield S3Config(accessKey,
                   secretKey,
                   bucketName,
                   Option(System.getProperty("branchname")) orElse config.getString("branchname") getOrElse "")
      
  }
}