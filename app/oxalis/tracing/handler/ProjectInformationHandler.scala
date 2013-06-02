package oxalis.tracing.handler

import net.liftweb.common.Box
import models.task.Project
import play.api.i18n.Messages
import models.tracing.CompoundAnnotation
import models.user.User
import models.annotation.{AnnotationRestrictions, TemporaryAnnotation}
import models.security.Role

object ProjectInformationHandler extends AnnotationInformationHandler {

  import braingames.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def projectAnnotationRestrictions(project: Project) =
    new AnnotationRestrictions {
      override def allowAccess(user: User) =
        Role.Admin.map(user.hasRole) getOrElse false
    }

  def provideAnnotation(projectName: String): Box[TemporaryAnnotation] = {
    for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
      annotation <- CompoundAnnotation.createFromProject(project) ?~ Messages("project.noAnnotations")
    } yield {
      annotation.copy(restrictions = projectAnnotationRestrictions(project))
    }
  }
}