package models.annotation

import scala.async.Async._
import scala.concurrent.Future

import com.scalableminds.util.io.NamedFileStream
import com.scalableminds.util.mvc.BoxImplicits
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task.TaskService
import models.user.{UsedAnnotationDAO, User}
import net.liftweb.common.{Box, Failure}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.JsValue
import reactivemongo.bson.BSONObjectID

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 21.01.14
 * Time: 14:06
 */
trait AnnotationMutationsLike {

  type AType <: AnnotationLike

  def resetToBase()(implicit ctx: DBAccessContext): Fox[AType]

  def reopen()(implicit ctx: DBAccessContext): Fox[AType]

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[AType]

  def cancelTask()(implicit ctx: DBAccessContext): Fox[AType]

  def loadAnnotationContent()(implicit ctx: DBAccessContext): Fox[NamedFileStream]
}

class AnnotationMutations(val annotation: Annotation)
  extends AnnotationMutationsLike
  with AnnotationFileService
  with AnnotationContentProviders
  with BoxImplicits
  with FoxImplicits {

  type AType = Annotation

  def finishAnnotation(user: User)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    def executeFinish(annotation: Annotation): Future[Box[(Annotation, String)]] = async {
      annotation match {
        case annotation if annotation._task.isEmpty =>
          val updated = await(annotation.muta.finish().futureBox)
          updated.map(_ -> "annotation.finished")
        case annotation                             =>
          val isReadyToBeFinished = await(annotation.isReadyToBeFinished)
          if (isReadyToBeFinished) {
            val updated = await(AnnotationDAO.finish(annotation._id).futureBox)
            updated.map(_ -> "task.finished")
          } else
              Failure("annotation.notFinishable")
      }
    }

    def tryToFinish(): Fox[(Annotation, String)] = {
      if (annotation.restrictions.allowFinish(user)) {
        if (annotation.state.isInProgress) {
          executeFinish(annotation)
        } else
            Future.successful(Failure("annotation.notInProgress"))
      } else
          Future.successful(Failure("annotation.notPossible"))
    }

    tryToFinish().map {
      result =>
        annotation.muta.writeAnnotationToFile()
        UsedAnnotationDAO.removeAll(annotation.id)
        result
    }
  }

  def reopen()(implicit ctx: DBAccessContext) = {
    AnnotationDAO.reopen(annotation._id)
  }

  def finish()(implicit ctx: DBAccessContext) =
    AnnotationDAO.finish(annotation._id)

  def rename(name: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.rename(annotation._id, name)

  def cancelTask()(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task
      _ <- TaskService.unassignOnce(task)
      _ <- AnnotationDAO.updateState(annotation, AnnotationState.Unassigned)
    } yield annotation
  }

  def incrementVersion()(implicit ctx: DBAccessContext) =
    AnnotationDAO.incrementVersion(annotation._id)

  def resetToBase()(implicit ctx: DBAccessContext) = {
    for {
      task <- annotation.task
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
