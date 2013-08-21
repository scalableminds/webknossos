package oxalis.annotation.handler

import net.liftweb.common.Box
import models.task.Project
import play.api.i18n.Messages
import models.user.User
import models.annotation.{AnnotationRestrictions, TemporaryAnnotation}
import models.security.Role
import models.tracing.skeleton.CompoundAnnotation
import braingames.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.util.{FoxImplicits, Fox}

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits{

  import braingames.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def projectAnnotationRestrictions(project: Project) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap {
          user =>
            Role.Admin.map(user.hasRole)
        } getOrElse false
    }

  def provideAnnotation(projectName: String)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    Future.successful(
      for {
        project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
        annotation <- CompoundAnnotation.createFromProject(project) ?~ Messages("project.noAnnotations")
      } yield {
        annotation.copy(restrictions = projectAnnotationRestrictions(project))
      })
  }
}