package oxalis.mturk

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

import akka.actor.{Actor, Props}
import com.amazonaws.services.sqs.model.Message
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.mturk.{MTurkSQSQueue, MTurkSQSQueueDAO}
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
object MTurkNotificationReceiver extends LazyLogging with FoxImplicits {

  lazy val sqsConfiguration = SQSConfiguration.fromConfig(current.configuration)

  def startDelayed(app: Application, delay: FiniteDuration) = {
    implicit val exco = Akka.system(app).dispatcher
    Akka.system(app).scheduler.scheduleOnce(delay) {
      notificationUrl.map { url =>
        logger.info("Using Amazon SQS notification url: " + url)
        Akka.system(app).actorOf(
          Props(classOf[MTurkNotificationActor], url),
          name = "mturkNotificationReceiver")
      }.futureBox.map {
        case f: Failure =>
          logger.error("Failed to start Notification receiver. Error: " + f.msg)
        case _          =>
      }
    }
  }

  def notificationUrl(implicit exco: ExecutionContext): Fox[String] = {
    MTurkSQSQueueDAO.findOne()(GlobalAccessContext).map(_.url).orElse {
      logger.info("Creating new SQS mturk notification queue")
      val helper = new SQSHelper(sqsConfiguration)
      val name = "wk-mturk-" + current.configuration.getString("application.branch").get.take(50) + "-" + System.currentTimeMillis()
      for {
        queueUrl <- helper.createMTurkQueue(name).toFox
        _ <- MTurkSQSQueueDAO.insert(MTurkSQSQueue(name, queueUrl))(GlobalAccessContext)
      } yield queueUrl
    }
  }

  case object RequestNotifications

  /**
    * Actor which will periodically retrieve notifications from SQS
    */
  class MTurkNotificationActor(queueUrl: String) extends Actor with LazyLogging with FoxImplicits {

    import MTurkNotifications._

    lazy val sqsHelper = new SQSHelper(sqsConfiguration)

    implicit val exco = context.dispatcher

    override def preStart() = {
      logger.info("Started mturk notification receiver.")
      context.system.scheduler.scheduleOnce(1.second, self, RequestNotifications)
    }

    def receive = {
      case RequestNotifications =>
        val messages = sqsHelper.fetchMessages(queueUrl)
        handleMTurkNotifications(messages).map { results =>
          // This might not be the best way to handle failures. Nevertheless, if we encounter an error at this point
          // we will encounter that error every time we process that message and hence if we don't delete it, we will
          // process it over and over and we will never process any other message anymore.
          results.zipWithIndex.foreach {
            case (f: Failure, idx) =>
              logger.warn("Failed to properly handle message: " + messages(idx).getBody + ". Error: " + f)
            case _                 =>
          }
          sqsHelper.deleteMessages(messages, queueUrl)
          context.system.scheduler.scheduleOnce(1.second, self, RequestNotifications)
        }.recover {
          case e: Exception =>
            logger.error(s"An exception occured while trying to poll SQS messages. ${e.getMessage}", e)
            context.system.scheduler.scheduleOnce(1.second, self, RequestNotifications)
        }
    }

    private def handleMTurkNotifications(messages: List[Message]) = {
      Fox.sequence(messages.map { message =>
        try {
          parseMTurkNotification(Json.parse(message.getBody)) match {
            case JsSuccess(notifications, _) =>
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
        logger.info(s"handling mturk assignment RETURNED request for assignment ${notif.AssignmentId} of hit ${notif.HITId}")
        MTurkService.handleAbandonedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentRejected  =>
        logger.info(s"handling mturk assignment REJECTED request for assignment ${notif.AssignmentId} of hit ${notif.HITId}")
        MTurkService.handleRejectedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentSubmitted =>
        logger.info(s"handling mturk assignment SUBMITTED request for assignment ${notif.AssignmentId} of hit ${notif.HITId}")
        MTurkService.handleSubmittedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentAbandoned =>
        logger.info(s"Handling mturk assignment ABANDONED request for assignment ${notif.AssignmentId} of hit ${notif.HITId}")
        MTurkService.handleAbandonedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkAssignmentAccepted  =>
        logger.info(s"Handling mturk assignment ACCEPTED request for assignment ${notif.AssignmentId} of hit ${notif.HITId}")
        MTurkService.handleAcceptedAssignment(notif.AssignmentId, notif.HITId)
      case notif: MTurkHITExpired =>
        logger.info(s"Handling mturk HIT EXPIRED of hit ${notif.HITId}")
        MTurkService.handleHITExpired(notif.HITId)
      case notif                           =>
        logger.info(s"NOT handling mturk notification $notif")
        Fox.successful(true)
    }

    private def parseMTurkNotification(js: JsValue) = {
      js.validate(mTurkEventsReads).map { eventContainer =>
        eventContainer.Events
      }
    }
  }

}
