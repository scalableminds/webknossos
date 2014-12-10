package oxalis.annotation

import akka.actor.Actor
import akka.agent.Agent
import akka.util.Timeout
import reactivemongo.bson.BSONObjectID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._
import net.liftweb.common.Box
import play.api.Logger
import models.annotation.{Annotation, AnnotationService, AnnotationType, AnnotationLike}
import oxalis.annotation.handler.AnnotationInformationHandler
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.libs.json.Json
import models.user.User
import net.liftweb.common.Failure

case class AnnotationIdentifier(annotationType: String, identifier: String)

object AnnotationIdentifier {
  implicit val annotationIdentifierFormat = Json.format[AnnotationIdentifier]
}

case class RequestAnnotation(id: AnnotationIdentifier, user: Option[User], implicit val ctx: DBAccessContext)

case class MergeAnnotation(annotation: Fox[AnnotationLike], annotationSec: Fox[AnnotationLike], readOnly: Boolean, user: User, implicit val ctx: DBAccessContext)

case class StoredResult(result: Fox[AnnotationLike], timestamp: Long = System.currentTimeMillis)

class AnnotationStore extends Actor {
  implicit val system = context.system
  implicit val exc = system.dispatcher
  val app = play.api.Play.current

  val maxWait = 5 seconds

  val maxCacheTime = 5 minutes

  val cachedAnnotations = Agent[Map[AnnotationIdentifier, StoredResult]](Map())

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

      requestFromCache(id)
        .getOrElse(requestFromHandler(id, user)(ctx))
        .futureBox
        .map {
        result =>
          s ! result
      }.recover {
        case e =>
          s ! Failure("AnnotationStore ERROR: " + e)
          Logger.error("AnnotationStore ERROR: " + e)
          e.printStackTrace()
      }
    case MergeAnnotation(annotation, annotationSec, readOnly, user, ctx) =>
      val s = sender

      mergeAnnotation(annotation, annotationSec, readOnly, user)(ctx)
        .futureBox
        .map {
        result =>
          Logger.debug("Result " + result)
          s ! result
      }.recover {
        case e =>
          s ! Failure("AnnotationStore ERROR: " + e)
          Logger.error("AnnotationStore ERROR: " + e)
          e.printStackTrace()
      }
  }

  def isExpired(maxAge: Duration)(result: StoredResult) =
    System.currentTimeMillis - result.timestamp > maxAge.toMillis

  def requestFromCache(id: AnnotationIdentifier): Option[Fox[AnnotationLike]] = {
    val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
    if (handler.cache) {
      cachedAnnotations()
        .get(id)
        .filterNot(isExpired(maxCacheTime))
        .map(_.result)
    } else
      None
  }

  def requestFromHandler(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    try {
      val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
      val f: Fox[AnnotationLike] =
        handler.provideAnnotation(id.identifier, user)
      if (handler.cache) {
        val stored = StoredResult(f)
        cachedAnnotations.send(_ + (id -> stored))
      }
      f
    } catch {
      case e: Exception =>
        Logger.error("Request Annotaton in AnnotationStore failed: " + e)
        throw e
    }
  }

  def mergeAnnotation(annotation: Fox[AnnotationLike], annotationSec: Fox[AnnotationLike], readOnly: Boolean, user: User)(implicit ctx: DBAccessContext) = {
    try {
      for {
        ann <- annotation
        annSec <- annotationSec
        mergedAnnotation <- AnnotationService.merge(readOnly, user._id, annSec.team, AnnotationType.Explorational, ann, annSec)
      } yield {
        // Caching of merged annotation
        val storedMerge = StoredResult(Some(mergedAnnotation))
        val mID = AnnotationIdentifier(mergedAnnotation.typ, mergedAnnotation.id)
        cachedAnnotations.send(_ + (mID -> storedMerge))
        mergedAnnotation
      }
    } catch {
      case e: Exception =>
        Logger.error("Request Annotation in AnnotationStore failed: " + e)
        throw e
    }
  }
}
