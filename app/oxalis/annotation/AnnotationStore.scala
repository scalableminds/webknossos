package oxalis.annotation

import akka.actor.Actor
import akka.agent.Agent
import akka.util.Timeout
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._
import net.liftweb.common.Box
import play.api.Logger
import models.annotation.AnnotationLike
import oxalis.annotation.handler.AnnotationInformationHandler
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.libs.json.Json
import models.user.User

case class AnnotationIdentifier(annotationType: String, identifier: String)

object AnnotationIdentifier{
  implicit val annotationIdentifierFormat = Json.format[AnnotationIdentifier]
}

case class RequestAnnotation(id: AnnotationIdentifier, user: Option[User], implicit val ctx: DBAccessContext)
case class MergeAnnotation(id: AnnotationIdentifier, mergedId: AnnotationIdentifier, user: Option[User], implicit val ctx: DBAccessContext)
case class StoredResult(result: Fox[AnnotationLike], timestamp: Long = System.currentTimeMillis)

class AnnotationStore extends Actor {
  implicit val system = context.system
  implicit val exc = system.dispatcher
  val app = play.api.Play.current

  val maxWait = 5 seconds

  val maxCacheTime = 5 minutes

  type AnnotationID = String
  val cachedAnnotations = Agent[Map[AnnotationID, StoredResult]](Map())

  def removeExpired() {
    cachedAnnotations.send {
      cached =>
        cached.filterNot(e => isExpired(maxCacheTime)(e._2))
    }
  }

  override def preStart() = {
    system.scheduler.schedule(maxCacheTime, maxCacheTime)(removeExpired)
  }

  def receive = {
    case RequestAnnotation(id, user, ctx) =>

      val s = sender
      cachedAnnotations()
        .get(id.identifier)
        .filterNot(isExpired(maxCacheTime))
        .map(_.result)
        .getOrElse(requestAnnotation(id, user)(ctx))
        .futureBox
        .map {
        result =>
          s ! result
      }.recover {
        case e =>
          Logger.error("AnnotationStore ERROR: " + e)
          e.printStackTrace()
      }
    case MergeAnnotation(id, mergedId, user, ctx) =>
      val s = sender

      val mID = id.identifier + mergedId.identifier

      cachedAnnotations()
        .get(mID)
        .filterNot(isExpired(maxCacheTime))
        .map(_.result)
        .getOrElse(mergeAnnotation(id, mergedId, user)(ctx))
        .futureBox
        .map {
        result =>
          Logger.debug("Result " +  result)
          s ! result
      }.recover {
        case e =>
          Logger.error("AnnotationStore ERROR: " + e)
          e.printStackTrace()
      }
  }

  def isExpired(maxAge: Duration)(result: StoredResult) =
    System.currentTimeMillis - result.timestamp > maxAge.toMillis

  def requestAnnotation(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    try {
      val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
      val f: Fox[AnnotationLike] =
        handler.provideAnnotation(id.identifier, user)
      if (handler.cache) {
        val stored = StoredResult(f)
        cachedAnnotations.send(_ + (id.identifier -> stored))
      }
      f
    } catch {
      case e: Exception =>
        Logger.error("Request Annotaton in AnnotationStore failed: " + e)
        throw e
    }
  }

  def mergeAnnotation(id: AnnotationIdentifier, mergedId: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    try {

      Logger.debug("merge")

//    ID section
      val handlerID = AnnotationInformationHandler.informationHandlers(id.annotationType)
      println(handlerID)
      val annotationID: Fox[AnnotationLike] = handlerID.provideAnnotation(id.identifier, user)

//    MergeID section
      val handlerMergedID = AnnotationInformationHandler.informationHandlers(mergedId.annotationType)
      val annotationMergedID: Fox[AnnotationLike] = handlerMergedID.provideAnnotation(mergedId.identifier, user)

      val newAnnotation = for {
        annotation <- annotationID
        annotationMerged <- annotationMergedID
      } yield {
        AnnotationLike.merge(annotation, annotationMerged)
      }

      if(handlerMergedID.cache) {
        val storedMerge = StoredResult(newAnnotation)
        val mID = id.identifier + mergedId.identifier
        cachedAnnotations.send(_ + (mID -> storedMerge))
      }

      newAnnotation
    } catch {
      case e: Exception =>
        Logger.error("Request Annotaton in AnnotationStore failed: " + e)
        throw e
    }
  }
}
