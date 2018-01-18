package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.project.ProjectDAO
import models.task.TaskDAO
import models.user.User
import reactivemongo.bson.BSONObjectID

import scala.concurrent.ExecutionContext.Implicits.global
import models.annotation.AnnotationState._

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(projectId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
  {
    for {
      project <- ProjectDAO.findOneById(projectId) ?~> "project.notFound"
      tasks <- TaskDAO.findAllByProject(project.name)
      annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten).toFox
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "project.noAnnotations"
      dataSetName = finishedAnnotations.head.dataSetName
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(project.id), persistTracing=false, user.map(_._id),
        dataSetName, project.team, AnnotationType.CompoundProject, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation
  }

  override def restrictionsFor(projectId: String)(implicit ctx: DBAccessContext) =
    for {
      project <- ProjectDAO.findOneById(projectId)
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.exists(_.isSuperVisorOf(project.team))
      }
    }
}
