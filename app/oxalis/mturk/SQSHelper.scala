package oxalis.mturk

import scala.collection.JavaConversions._

import com.amazonaws.auth.BasicAWSCredentials
import com.amazonaws.services.sqs.AmazonSQSClient
import com.amazonaws.services.sqs.model._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}

object SQSHelper{
  def mturkAWSPolicy(region: String, userId: String, queueName: String) = {
    s"""
      |{
      |  "Version": "2012-10-17",
      |  "Id": "arn:aws:sqs:$region:$userId:$queueName/SQSDefaultPolicy",
      |  "Statement": [
      |    {
      |      "Effect": "Allow",
      |      "Principal": {
      |        "AWS": "arn:aws:iam::755651556756:user/MTurk-SQS"
      |      },
      |      "Action": "SQS:SendMessage",
      |      "Resource": "arn:aws:sqs:$region:$userId:$queueName"
      |    }
      |  ]
      |}
    """.stripMargin
  }
}

/**
  * Helper to handle SQS Interface ( lots of ugly Java Api )
  */
class SQSHelper(sqsConfig: SQSConfiguration) extends LazyLogging {

  private val client = new AmazonSQSClient(new BasicAWSCredentials(sqsConfig.accessKey, sqsConfig.secretKey))
  client.setEndpoint(sqsConfig.endpoint)

  def fetchMessages(queueUrl: String): List[Message] = {
    try {
      val request = new ReceiveMessageRequest(queueUrl)
                    .withWaitTimeSeconds(20)
                    .withMaxNumberOfMessages(10)

      client.receiveMessage(request).getMessages.toList
    } catch {
      case e: Exception =>
        logger.error(s"Failed to fetch SQS messages. Error: ${e.getMessage}", e)
        Nil
    }
  }

  def createMTurkQueue(name: String): Box[String] = {
    try {
      val createRequest = new CreateQueueRequest(name)
                            .addAttributesEntry("Policy", SQSHelper.mturkAWSPolicy(sqsConfig.region, sqsConfig.clientId, name))
      val result = client.createQueue(createRequest)

      Full(result.getQueueUrl)
    } catch {
      case e: Exception =>
        logger.error(s"Failed to create SQS queue '$name': ${e.getMessage}", e)
        Failure(s"Failed to create SQS queue '$name': ${e.getMessage}", Full(e), Empty)
    }
  }

  def deleteMessages(messages: List[Message], queueUrl: String) = {
    try {
      if (messages.nonEmpty) {
        val entries = messages.map { message =>
          new DeleteMessageBatchRequestEntry(message.getMessageId, message.getReceiptHandle)
        }
        client.deleteMessageBatch(new DeleteMessageBatchRequest(queueUrl, entries))
      }
    } catch {
      case e: Exception =>
        logger.error(s"Failed to delete SQS messages. Error: ${e.getMessage}", e)
        Nil
    }
  }

  def send(body: String, queueUrl: String) = {
    client.sendMessage(new SendMessageRequest(queueUrl, body))
  }

}
