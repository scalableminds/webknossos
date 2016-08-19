/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package oxalis.mturk

import play.api.Configuration

case class SQSConfiguration(accessKey: String, secretKey: String, queueName: String, endpoint: String)

class InvalidSQSConfiguration(msg: String) extends Exception(msg)

object SQSConfiguration{
  def fromConfig(config: Configuration) = {
    val accessKey =
      config.getString("amazon.sqs.accessKey").getOrElse(throw new InvalidSQSConfiguration("Missing sqs accesskey"))
    val secretKey =
      config.getString("amazon.sqs.secretKey").getOrElse(throw new InvalidSQSConfiguration("Missing sqs secretKey"))
    val queueName =
      config.getString("amazon.sqs.queueName").getOrElse(throw new InvalidSQSConfiguration("Missing sqs queueName"))
    val endpoint =
      config.getString("amazon.sqs.endpoint").getOrElse(throw new InvalidSQSConfiguration("Missing sqs endpoint"))
    SQSConfiguration(accessKey, secretKey, queueName, endpoint)
  }
}
