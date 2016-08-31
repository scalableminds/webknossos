package oxalis.mturk

import scala.collection.JavaConversions._

import com.amazonaws.auth.BasicAWSCredentials
import com.amazonaws.services.sqs.AmazonSQSClient
import com.amazonaws.services.sqs.model._
import com.typesafe.scalalogging.LazyLogging

/**
  * Helper to handle SQS Interface ( lots of uggly Java Api )
  */
class SQSHelper(sqsConfig: SQSConfiguration) extends LazyLogging {

  private val client = new AmazonSQSClient(new BasicAWSCredentials(sqsConfig.accessKey, sqsConfig.secretKey))
  client.setEndpoint(sqsConfig.endpoint)

  private lazy val queueUrl = client.getQueueUrl(sqsConfig.queueName).getQueueUrl

  def fetchMessages: List[Message] = {
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

  def deleteMessages(messages: List[Message]) = {
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

  def send(body: String) = {
    client.sendMessage(new SendMessageRequest(queueUrl, body))
  }

}
