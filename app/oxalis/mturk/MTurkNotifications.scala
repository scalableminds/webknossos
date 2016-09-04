package oxalis.mturk

import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json._

trait MTurkNotification

object MTurkNotifications extends LazyLogging {

  /**
    * DONT'T CHANGE THE CASING OF THE VARIABLES. They reflect the naming from amazon turk notifications and are used
    * for parsing the messages.
    */
  implicit object MTurkNotificationReads extends Reads[MTurkNotification] with LazyLogging {
    override def reads(json: JsValue): JsResult[MTurkNotification] = (json \ "EventType").asOpt[String] match {
      case Some("AssignmentSubmitted") => json.validate(mTurkAssignmentSubmittedReads)
      case Some("AssignmentReturned")  => json.validate(mTurkAssignmentReturnedReads)
      case Some("AssignmentAbandoned") => json.validate(mTurkAssignmentAbandonedReads)
      case Some("AssignmentRejected")  => json.validate(mTurkAssignmentRejectedReads)
      case Some("AssignmentAccepted")  => json.validate(mTurkAssignmentAcceptedReads)
      case Some("HITExpired")          => json.validate(mTurkHITExpiredReads)
      case Some("HITReviewable")       => JsSuccess(MTurkHITReviewable)
      case _                           =>
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

  implicit val mTurkAssignmentRejectedReads = Json.reads[MTurkAssignmentRejected]

  case class MTurkAssignmentRejected(HITId: String, AssignmentId: String, HITTypeId: String) extends MTurkNotification

  implicit val mTurkAssignmentAcceptedReads = Json.reads[MTurkAssignmentAccepted]

  case class MTurkAssignmentAccepted(HITId: String, AssignmentId: String, HITTypeId: String) extends MTurkNotification

  implicit val mTurkHITExpiredReads = Json.reads[MTurkHITExpired]

  case class MTurkHITExpired(HITId: String) extends MTurkNotification

  case object MTurkHITReviewable extends MTurkNotification

  implicit val mTurkEventsReads = Json.reads[MTurkEvents]

  case class MTurkEvents(Events: Array[MTurkNotification], EventDocId: String, CustomerId: String)

}
