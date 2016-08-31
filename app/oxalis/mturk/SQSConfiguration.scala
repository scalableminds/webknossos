package oxalis.mturk

import play.api.Configuration

case class SQSConfiguration(accessKey: String, secretKey: String, endpoint: String, clientId: String)

class InvalidSQSConfiguration(msg: String) extends Exception(msg)

object SQSConfiguration{
  /**
    * SQS configuration parser
    */
  def fromConfig(config: Configuration) = {
    val accessKey =
      config.getString("amazon.sqs.accessKey").getOrElse(throw new InvalidSQSConfiguration("Missing sqs accesskey"))
    val secretKey =
      config.getString("amazon.sqs.secretKey").getOrElse(throw new InvalidSQSConfiguration("Missing sqs secretKey"))
    val endpoint =
      config.getString("amazon.sqs.endpoint").getOrElse(throw new InvalidSQSConfiguration("Missing sqs endpoint"))
    val clientId =
      config.getString("amazon.sqs.clientId").getOrElse(throw new InvalidSQSConfiguration("Missing sqs client id"))
    SQSConfiguration(accessKey, secretKey, endpoint, clientId)
  }
}
