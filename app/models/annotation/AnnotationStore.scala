package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.annotation.handler.AnnotationInformationHandler
import models.user.User
import net.liftweb.common.Failure
import play.api.Play.current
import play.api.cache.Cache
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID

import scala.concurrent.duration._

object AnnotationStore extends LazyLogging {

  private val maxCacheTime = 5 minutes

  case class StoredResult(result: Fox[Annotation], timestamp: Long = System.currentTimeMillis)

  def cachedAnnotation(annotationId: AnnotationIdentifier): Option[StoredResult] = {
    Cache.getAs[StoredResult](annotationId.toUniqueString)
  }

  def requestAnnotation(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    requestFromCache(id)
    .getOrElse(requestFromHandler(id, user)(ctx))
    .futureBox
    .recover {
      case e =>
        logger.error("AnnotationStore ERROR: " + e)
        e.printStackTrace()
        Failure("AnnotationStore ERROR: " + e)
    }
  }

  def mergeAnnotation(
    annotation: Fox[Annotation],
    annotationSec: Fox[Annotation],
    readOnly: Boolean,
    user: User)(implicit ctx: DBAccessContext) = {

    executeAnnotationMerge(annotation, annotationSec, readOnly, user)(ctx)
    .flatten
    .futureBox
    .recover {
      case e =>
        logger.error("AnnotationStore ERROR: " + e)
        e.printStackTrace()
        Failure("AnnotationStore ERROR: " + e)
    }
  }

  private def requestFromCache(id: AnnotationIdentifier): Option[Fox[Annotation]] = {
    val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
    if (handler.cache) {
      cachedAnnotation(id).map(_.result)
    } else
        None
  }

  private def requestFromHandler(id: AnnotationIdentifier, user: Option[User])(implicit ctx: DBAccessContext) = {
    try {
      val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
      val f: Fox[Annotation] =
        handler.provideAnnotation(id.identifier, user)
      if (handler.cache) {
        val stored = StoredResult(f)
        Cache.set(id.toUniqueString, stored, maxCacheTime)
      }
      f
    } catch {
      case e: Exception =>
        logger.error("Request Annotaton in AnnotationStore failed: " + e)
        throw e
    }
  }

  private def executeAnnotationMerge(
    annotation: Fox[Annotation],
    annotationSec: Fox[Annotation],
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
        logger.error("Request Annotation in AnnotationStore failed: " + e)
        throw e
    }
  }
}
