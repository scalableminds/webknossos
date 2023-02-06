package models.annotation

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import models.user.{User, UserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

case class AnnotationMutex(annotationId: ObjectId, userId: ObjectId, expiry: Instant) {
  def isExpired: Boolean = expiry.isPast
}

case class MutexResult(canEdit: Boolean, blockedByUser: Option[ObjectId])

class AnnotationMutexService @Inject()(userDAO: UserDAO, userService: UserService) {
  private val defaultExpiryTime = 2 minutes

  private val mutexes: scala.collection.mutable.Map[ObjectId, AnnotationMutex] =
    scala.collection.mutable.Map()

  def tryAcquiringAnnotationMutex(annotationId: ObjectId, userId: ObjectId): MutexResult =
    mutexes.synchronized {
      mutexes.get(annotationId).map { mutex =>
        if (!mutex.isExpired) {
          if (mutex.userId == userId)
            refresh(mutex)
          else
            MutexResult(canEdit = false, blockedByUser = Some(mutex.userId))
        } else {
          acquire(annotationId, userId)
        }
      }
    }.getOrElse {
      acquire(annotationId, userId)
    }

  private def acquire(annotationId: ObjectId, userId: ObjectId): MutexResult = {
    mutexes.put(annotationId, AnnotationMutex(annotationId, userId, Instant.in(defaultExpiryTime)))
    MutexResult(canEdit = true, None)
  }

  private def refresh(mutex: AnnotationMutex): MutexResult = {
    mutexes.put(mutex.annotationId, mutex.copy(expiry = Instant.in(defaultExpiryTime)))
    MutexResult(canEdit = true, None)
  }

  def publicWrites(mutexResult: MutexResult, requestingUser: User)(implicit ec: ExecutionContext): Fox[JsObject] =
    for {
      userOpt <- Fox.runOptional(mutexResult.blockedByUser)(user => userDAO.findOne(user)(GlobalAccessContext))
      userJsonOpt <- Fox.runOptional(userOpt)(user => userService.publicWrites(user, requestingUser))
    } yield
      Json.obj(
        "canEdit" -> mutexResult.canEdit,
        "blockedByUser" -> userJsonOpt
      )

}
