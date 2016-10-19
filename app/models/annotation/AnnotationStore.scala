package models.annotation

import scala.concurrent.duration._

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.user.User
import net.liftweb.common.Failure
import models.annotation.handler.AnnotationInformationHandler
import play.api.Logger
import play.api.Play.current
import play.api.cache.Cache
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID

object AnnotationStore {

  private val maxCacheTime = 5 minutes

  case class StoredResult(result: Fox[AnnotationLike], timestamp: Long = System.currentTimeMillis)

  def cachedAnnotation(annotationId: AnnotationIdentifier): Option[StoredResult] = {
    Cache.getAs[StoredResult](annotationId.toUniqueString)
  }

  def requestAnnotation(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    requestFromCache(id)
    .getOrElse(requestFromHandler(id, user)(ctx))
    .futureBox
    .recover {
      case e =>
        Logger.error("AnnotationStore ERROR: " + e)
        e.printStackTrace()
        Failure("AnnotationStore ERROR: " + e)
    }
  }

  def mergeAnnotation(
    annotation: Fox[AnnotationLike],
    annotationSec: Fox[AnnotationLike],
    readOnly: Boolean,
    user: User)(implicit ctx: DBAccessContext) = {

    executeAnnotationMerge(annotation, annotationSec, readOnly, user)(ctx)
    .flatten
    .futureBox
    .recover {
      case e =>
        Logger.error("AnnotationStore ERROR: " + e)
        e.printStackTrace()
        Failure("AnnotationStore ERROR: " + e)
    }
  }

  private def requestFromCache(id: AnnotationIdentifier): Option[Fox[AnnotationLike]] = {
    val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
    if (handler.cache) {
      cachedAnnotation(id).map(_.result)
    } else
        None
  }

  private def requestFromHandler(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    try {
      val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
      val f: Fox[AnnotationLike] =
        handler.provideAnnotation(id.identifier, user)
      if (handler.cache) {
        val stored = StoredResult(f)
        Cache.set(id.toUniqueString, stored, maxCacheTime)
      }
      f
    } catch {
      case e: Exception =>
        Logger.error("Request Annotaton in AnnotationStore failed: " + e)
        throw e
    }
  }

  private def executeAnnotationMerge(
    annotation: Fox[AnnotationLike],
    annotationSec: Fox[AnnotationLike],
    readOnly: Boolean,
    user: User)(implicit ctx: DBAccessContext) = {

    try {
      for {
        ann <- annotation
        annSec <- annotationSec
        newId = BSONObjectID.generate()
        mergedAnnotation = AnnotationService.merge(newId, readOnly, user._id, annSec.team, AnnotationType.Explorational, ann, annSec)
      } yield {
        // Caching of merged annotation
        val storedMerge = StoredResult(mergedAnnotation)
        val mID = AnnotationIdentifier(AnnotationType.Explorational, newId.stringify)
        Cache.set(mID.toUniqueString, storedMerge, maxCacheTime)
        mergedAnnotation
      }
    } catch {
      case e: Exception =>
        Logger.error("Request Annotation in AnnotationStore failed: " + e)
        throw e
    }
  }
}
