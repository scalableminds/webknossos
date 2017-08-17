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

  private def requestFromCache(id: AnnotationIdentifier): Option[Fox[Annotation]] = None /*{ //TODO: RocksDB
    val handler = AnnotationInformationHandler.informationHandlers(id.annotationType)
    if (handler.cache) {
      cachedAnnotation(id).map(_.result)
    } else
        None
  }*/

  private def cachedAnnotation(annotationId: AnnotationIdentifier): Option[StoredResult] = {
    Cache.getAs[StoredResult](annotationId.toUniqueString)
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

  def storeAnnotationInCache(annotation: Fox[Annotation], id: BSONObjectID) = {
    val storedMerge = StoredResult(annotation)
    val mID = AnnotationIdentifier(AnnotationType.Explorational, id.stringify)
    Cache.set(mID.toUniqueString, storedMerge, maxCacheTime)
  }
}
