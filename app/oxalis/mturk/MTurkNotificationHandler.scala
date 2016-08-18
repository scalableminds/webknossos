/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package oxalis.mturk

import akka.actor.{Actor, Props}
import com.scalableminds.util.mail.Mailer
import play.api.Application
import play.api.libs.concurrent.Akka
import scala.concurrent.duration._

import com.amazonaws.services.sqs.model.Message
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import play.api.libs.json._
import play.api.Play.current

trait MTurkNotification


object MTurkNotifications {
  /**
    * DONT'T CHANGE THE CASING OF THE VARIABLES. They reflect the naming from amazon turk notifications and are used
    * for parsing the messages.
    */
  implicit object MTurkNotificationReads extends Reads[MTurkNotification] with LazyLogging{
    override def reads(json: JsValue): JsResult[MTurkNotification] = (json \ "EventType").asOpt[String] match {
      case Some("AssignmentSubmitted") => json.validate(mTurkAssignmentSubmittedReads)
      case Some("AssignmentReturned") => json.validate(mTurkAssignmentReturnedReads)
      case Some("AssignmentAbandoned") => json.validate(mTurkAssignmentAbandonedReads)
      case Some("HITExpired") => JsSuccess(MTurkHITExpired)
      case Some("HITReviewable") => JsSuccess(MTurkHITReviewable)
      case _ =>
        logger.warn(s"Encountered unknown MTurk notification while parsing: $json")
        JsSuccess(MTurkUnknownNotification)
    }
  }

  case object MTurkUnknownNotification extends MTurkNotification

  implicit val mTurkAssignmentReturnedReads = Json.reads[MTurkAssignmentReturned]
  case class MTurkAssignmentReturned(HITId: String, AssignmentId: String, HITTypeId: String) extends MTurkNotification

  implicit val mTurkAssignmentSubmittedReads = Json.reads[MTurkAssignmentSubmitted]
  case class MTurkAssignmentSubmitted(HITId: String, AssignmentId: String, HITTypeId: String) extends MTurkNotification

  implicit val mTurkAssignmentAbandonedReads = Json.reads[MTurkAssignmentAbandoned]
  case class MTurkAssignmentAbandoned(HITId: String, AssignmentId: String, HITTypeId: String) extends MTurkNotification

  case object MTurkHITExpired extends MTurkNotification

  case object MTurkHITReviewable extends MTurkNotification

  implicit val mTurkEventsReads = Json.reads[MTurkEvents]
  case class MTurkEvents(Events: Array[MTurkNotification], EventDocId: String, CustomerId: String)
}



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

  class MTurkNotificationReceiver extends Actor with LazyLogging with FoxImplicits{
    import MTurkNotifications._

    lazy val sqsHelper = new SQSHelper(sqsConfiguration)

    implicit val exco = context.dispatcher

    override def preStart() = {
      context.system.scheduler.scheduleOnce(1.second, self, RequestNotifications)
    }

    def receive = {
      case RequestNotifications =>
        val messages = sqsHelper.fetchMessages
        handleMTurkNotifications(messages).map{ results =>
          results.zipWithIndex.foreach{
            case (f: Failure, idx) =>
              logger.warn("Failed to properly handle message: " + messages(idx).getBody + ". Error: " + f)
            case _ =>
          }
          sqsHelper.deleteMessages(messages)
          self ! RequestNotifications
        }
    }

    private def handleMTurkNotifications(messages: List[Message]) = {
      Fox.serialSequence(messages){ message =>
        try {
          parseMTurkNotification(Json.parse(message.getBody)) match {
            case JsSuccess(notifications, _) =>
              logger.debug("successfully parsed wrapper for mturk notification body!")
              Fox.combined(notifications.toList.map(handleSingleMTurkNotification))
            case e: JsError =>
              logger.warn("Failed to parse MTurk notification json: " + e)
              Fox.failure("Failed to process SQS message due to json parsing issues.")
          }
        } catch {
          case e: Exception =>
            logger.error(s"Failed to process SQS message: ${message.getBody}")
            Fox.failure("Failed to process SQS message", Full(e))
        }
      }
    }

    private def handleSingleMTurkNotification(notification: MTurkNotification): Fox[Boolean] = notification match {
      case notif: MTurkAssignmentReturned =>
        // Let's treat it the same as an abandoned assignment
        logger.info(s"handling mturk assignment RETURNED request for assignment ${notif.AssignmentId}")
        MTurkService.handleAbandonedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentSubmitted =>
        logger.info(s"handling mturk assignment SUBMITTED request for assignment ${notif.AssignmentId}")
        MTurkService.handleSubmittedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentAbandoned =>
        logger.info(s"Handling mturk assignment ABANDONED request for assignment ${notif.AssignmentId}")
        MTurkService.handleAbandonedAssignment(notif.AssignmentId, notif.HITId)
      case _ =>
        Fox.successful(true)
    }

    private def parseMTurkNotification(js: JsValue) = {
      js.validate(mTurkEventsReads).map{ eventContainer =>
        eventContainer.Events
      }
    }
  }

}
