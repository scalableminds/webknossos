package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.project.{Project, ProjectDAO}
import models.task.TaskDAO
import models.team.Role
import models.user.User
import reactivemongo.bson.BSONObjectID

import scala.concurrent.ExecutionContext.Implicits.global

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  //TODO: rocksDB test this
  def provideAnnotation(projectName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
  {
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> "project.notFound"
      tasks <- TaskDAO.findAllByProject(project.name)
      annotations <- Fox.serialSequence(tasks)(_.annotations).map(_.flatten).toFox
      finishedAnnotations = annotations.filter(_.state.isFinished)
      dataSetName = finishedAnnotations.head.dataSetName
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(project.name), persistTracing=false, user.map(_._id),
        dataSetName, project.team, AnnotationType.CompoundProject, annotations) ?~> "project.noAnnotation"
    } yield mergedAnnotation
  }

  override def restrictionsFor(projectName: String)(implicit ctx: DBAccessContext) =
    for {
      project <- ProjectDAO.findOneByName(projectName)
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.flatMap(_.roleInTeam(project.team)).contains(Role.Admin)
      }
    }
}
