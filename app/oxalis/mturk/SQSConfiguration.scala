package oxalis.mturk

import play.api.Configuration

case class SQSConfiguration(accessKey: String, secretKey: String, region: String, clientId: String) {
  def endpoint =
    s"https://sqs.$region.amazonaws.com/"
}

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
    val region =
      config.getString("amazon.sqs.region").getOrElse(throw new InvalidSQSConfiguration("Missing sqs region"))
    val clientId =
      config.getString("amazon.sqs.clientId").getOrElse(throw new InvalidSQSConfiguration("Missing sqs client id"))
    SQSConfiguration(accessKey, secretKey, region, clientId)
  }
}
