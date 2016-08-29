package oxalis.mturk

import scala.concurrent.duration._

import akka.actor.{Actor, Props}
import com.amazonaws.services.sqs.model.Message
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import play.api.Application
import play.api.Play.current
import play.api.libs.concurrent.Akka
import play.api.libs.json._

/**
  * This handler will process notifications from mturk using the amazon SQS message Queue. mturk will post
  * its notifications to the persitant SQS service. After that, we can request the notifications from SQS and
  * delete them after we have processed them (this allows fail safty and ensures that we will never miss a notification)
  */
object MTurkNotificationHandler {

  lazy val sqsConfiguration = {
    val accessKey = current.configuration.getString("amazon.sqs.accessKey").get
    val secretKey = current.configuration.getString("amazon.sqs.secretKey").get
    val queueName = current.configuration.getString("amazon.sqs.queueName").get
    val endpoint = current.configuration.getString("amazon.sqs.endpoint").get
    SQSConfiguration(accessKey, secretKey, queueName, endpoint)
  }

  def start(app: Application) = {
    Akka.system(app).actorOf(
      Props[MTurkNotificationReceiver],
      name = "mturkNotificationReceiver")
  }

  case object RequestNotifications

  /**
    * Actor which will periodically retrieve notifications from SQS
    */
  class MTurkNotificationReceiver extends Actor with LazyLogging with FoxImplicits {

    import MTurkNotifications._

    lazy val sqsHelper = new SQSHelper(sqsConfiguration)

    implicit val exco = context.dispatcher

    override def preStart() = {
      logger.info("Started mturk notification receiver.")
      context.system.scheduler.scheduleOnce(1.second, self, RequestNotifications)
    }

    def receive = {
      case RequestNotifications =>
        val messages = sqsHelper.fetchMessages
        if(messages.nonEmpty)
          logger.info("Received messages ("+messages.length+"): "  + messages.map(x => x.getMessageId + ": " + x.getBody).mkString("\n\t","\n\t", ""))
        handleMTurkNotifications(messages).map { results =>
          // This might not be the best way to handle failures. Nevertheless, if we encounter an error at this point
          // we will encounter that error every time we process that message and hence if we don't delete it, we will
          // process it over and over and we will never process any other message anymore.
          results.zipWithIndex.foreach {
            case (f: Failure, idx) =>
              logger.warn("Failed to properly handle message: " + messages(idx).getBody + ". Error: " + f)
            case _                 =>
          }
          sqsHelper.deleteMessages(messages)
          self ! RequestNotifications
        }
    }

    private def handleMTurkNotifications(messages: List[Message]) = {
      Fox.sequence(messages.map{ message =>
        try {
          parseMTurkNotification(Json.parse(message.getBody)) match {
            case JsSuccess(notifications, _) =>
              logger.info("successfully parsed wrapper for mturk notification body!")
              Fox.combined(notifications.toList.map(handleSingleMTurkNotification))
            case e: JsError                  =>
              logger.warn("Failed to parse MTurk notification json: " + e)
              Fox.failure("Failed to process SQS message due to json parsing issues.")
          }
        } catch {
          case e: Exception =>
            logger.error(s"Failed to process SQS message: ${message.getBody}")
            Fox.failure("Failed to process SQS message", Full(e))
        }
      })
    }

    /**
      * Handle mturk notifications and execute necassary commands to keep overall state consistent
      *
      * @param notification mturk parsed notifications
      * @return success
      */
    private def handleSingleMTurkNotification(notification: MTurkNotification): Fox[Boolean] = notification match {
      case notif: MTurkAssignmentReturned  =>
        // Let's treat it the same as an abandoned assignment
        logger.info(s"handling mturk assignment RETURNED request for assignment ${notif.AssignmentId}")
        MTurkService.handleAbandonedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentRejected =>
        // Let's treat it the same as an abandoned assignment
        logger.info(s"handling mturk assignment REJECTED request for assignment ${notif.AssignmentId}")
        MTurkService.handleAbandonedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentSubmitted =>
        logger.info(s"handling mturk assignment SUBMITTED request for assignment ${notif.AssignmentId}")
        MTurkService.handleSubmittedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentAbandoned =>
        logger.info(s"Handling mturk assignment ABANDONED request for assignment ${notif.AssignmentId}")
        MTurkService.handleAbandonedAssignment(notif.AssignmentId, notif.HITId)
      case notif                               =>
        logger.info(s"NOT handling mturk noticiation $notif")
        Fox.successful(true)
    }

    private def parseMTurkNotification(js: JsValue) = {
      js.validate(mTurkEventsReads).map { eventContainer =>
        eventContainer.Events
      }
    }
  }

}
