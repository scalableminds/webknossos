/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import models.annotation.AnnotationState._
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

class AnnotationMutations(val annotation: AnnotationSQL) extends BoxImplicits with FoxImplicits {

  def finishAnnotation(user: User, restrictions: AnnotationRestrictions)(implicit ctx: DBAccessContext): Fox[String] = {
    def executeFinish: Fox[String] = {
      for {
        _ <- AnnotationService.finish(annotation)
      } yield {
        if (annotation._task.isEmpty)
          "annotation.finished"
        else
          "task.finished"
      }
    }

    if (restrictions.allowFinish(user)) {
      if (annotation.state == Active)
        executeFinish
      else
        Fox.failure("annotation.notActive")
    } else {
      Fox.failure("annotation.notPossible")
    }
  }

  def reopen(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.updateState(annotation._id, AnnotationState.Active)

  def rename(name: String)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.updateName(annotation._id, name)

  def setDescription(description: String)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.updateDescription(annotation._id, description)

  def setIsPublic(isPublic: Boolean)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.updateIsPublic(annotation._id, isPublic)

  def setTags(tags: List[String])(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.updateTags(annotation._id, tags)

  def cancel(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.updateState(annotation._id, Cancelled)

  def transferToUser(user: User)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.updateUser(annotation._id, ObjectId.fromBsonId(user._id))

  def resetToBase(implicit ctx: DBAccessContext) = annotation.typ match {
    case AnnotationTypeSQL.Explorational =>
      Fox.failure("annotation.revert.skeletonOnly")
    case AnnotationTypeSQL.Task if annotation.tracingType == TracingType.skeleton =>
      for {
        task <- annotation.task.toFox
        annotationBase <- task.annotationBase
        newTracingReference <- AnnotationService.tracingFromBase(annotationBase)
        _ <- AnnotationSQLDAO.updateTracingReference(annotation._id, newTracingReference)
      } yield ()
    case _ if annotation.tracingType != TracingType.skeleton =>
      Fox.failure("annotation.revert.skeletonOnly")
  }
}
