/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import models.annotation.AnnotationService
import models.mturk.MTurkAssignmentDAO
import models.user.UserService
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._

class MTurkController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  def startAssignment(id: String, workerId: String, assignmentId: String) = Authenticated.async {
    implicit request =>
      for {
        mturkAssignment <- MTurkAssignmentDAO.findByKey(id)(GlobalAccessContext)
        task <- mturkAssignment.task(GlobalAccessContext)
        user <- UserService.prepareMTurkUser(workerId, task.team, task.neededExperience)(GlobalAccessContext)
        annotation <- AnnotationService.createAnnotationFor(user, task)(GlobalAccessContext) ?~> Messages("annotation.creationFailed")
      } yield {
        Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
          .withSession(Secured.createSession(user))
      }
  }
}
