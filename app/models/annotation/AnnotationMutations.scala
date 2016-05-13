package models.annotation

import com.scalableminds.util.io.NamedFileStream
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.libs.json.JsValue
import com.scalableminds.util.mvc.BoxImplicits
import models.user.{UsedAnnotationDAO, User}
import scala.concurrent.Future
import net.liftweb.common.{Failure, Box}
import scala.async.Async._
import play.api.i18n.Messages
import models.task.{OpenAssignmentService, TaskService}
import reactivemongo.bson.BSONObjectID
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 21.01.14
 * Time: 14:06
 */
trait AnnotationMutationsLike{

  type AType <: AnnotationLike

  def resetToBase()(implicit ctx: DBAccessContext): Fox[AType]

  def reopen()(implicit ctx: DBAccessContext): Fox[AType]

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[AType]

  def cancelTask()(implicit ctx: DBAccessContext): Fox[AType]

  def loadAnnotationContent()(implicit ctx: DBAccessContext): Fox[NamedFileStream]
}

class AnnotationMutations(val annotation: Annotation) extends AnnotationMutationsLike with AnnotationFileService with AnnotationContentProviders with BoxImplicits with FoxImplicits{
  type AType = Annotation

  def finishAnnotation(user: User)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    def executeFinish(annotation: Annotation): Future[Box[(Annotation, String)]] = async {
      annotation match {
        case annotation if annotation._task.isEmpty =>
          val updated = await(annotation.muta.finish().futureBox)
          updated.map(_ -> Messages("annotation.finished"))
        case annotation =>
          val isReadyToBeFinished = await(annotation.isReadyToBeFinished)
          if (isReadyToBeFinished) {
            val updated = await(annotation.muta.finish().futureBox)
            updated.map(_ -> Messages("task.finished"))
          } else
            Failure(Messages("annotation.notFinishable"))
      }
    }

    def tryToFinish(): Fox[(Annotation, String)] = {
      if (annotation.restrictions.allowFinish(user)) {
        if (annotation.state.isInProgress) {
          executeFinish(annotation)
        } else
          Future.successful(Failure(Messages("annotation.notInProgress")))
      } else
        Future.successful(Failure(Messages("annotation.notPossible")))
    }

    tryToFinish().map {
      result =>
        annotation.muta.writeAnnotationToFile()
        UsedAnnotationDAO.removeAll(annotation.id)
        result
    }
  }

  def reopen()(implicit ctx: DBAccessContext) = {
    if (annotation.typ == AnnotationType.Task)
      AnnotationDAO.reopen(annotation._id)
    else
      Future.successful(None)
  }

  def finish()(implicit ctx: DBAccessContext) =
    AnnotationDAO.finish(annotation._id)

  def rename(name: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.rename(annotation._id, name)

  def cancelTask()(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task
      _ <- OpenAssignmentService.insertOneFor(task)
      _ <- AnnotationDAO.updateState(annotation, AnnotationState.Unassigned)
    } yield annotation
  }

  def incrementVersion()(implicit ctx: DBAccessContext) =
    AnnotationDAO.incrementVersion(annotation._id)

  def resetToBase()(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task.toFox
      annotationContent <- annotation.content
      tracingBase <- task.annotationBase.flatMap(_.content)
      reset <- tracingBase.temporaryDuplicate(id = BSONObjectID.generate.stringify).flatMap(_.saveToDB)
      _ <- annotationContent.service.clearTracingData(annotationContent.id)
      updatedAnnotation <- AnnotationDAO.updateContent(annotation._id, ContentReference.createFor(reset))
    } yield updatedAnnotation
  }

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext) = {
    annotation.content.flatMap(_.updateFromJson(js)).flatMap(_ =>
      AnnotationDAO.incrementVersion(annotation._id))
  }

  def transferToUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      updatedAnnotation <- AnnotationDAO.transfer(annotation._id, user._id)
    } yield updatedAnnotation
  }
}
