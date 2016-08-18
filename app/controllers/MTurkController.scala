/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import models.annotation.{AnnotationDAO, AnnotationService}
import models.mturk.{MTurkAnnotationReference, MTurkAssignment, MTurkAssignmentDAO}
import models.task.Task
import models.user.{User, UserService}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._

class MTurkController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  def startAssignment(id: String, workerId: String, assignmentId: String) = Authenticated.async {
    implicit request =>
      def annotationForAssignment(mturkAssignment: MTurkAssignment, user: User, task: Task) = {
        mturkAssignment.annotations.find(reference => reference._user == user._id) match {
          case Some(reference) =>
            AnnotationDAO.findOneById(reference._annotation)(GlobalAccessContext)
          case None =>
            for {
              annotation <- AnnotationService.createAnnotationFor(user, task)(GlobalAccessContext)
              _ <- MTurkAssignmentDAO.appendReference(mturkAssignment._id, MTurkAnnotationReference(annotation._id, user._id))
            } yield annotation
        }
      }

      for {
        mturkAssignment <- MTurkAssignmentDAO.findByKey(id)(GlobalAccessContext)
        task <- mturkAssignment.task(GlobalAccessContext)
        user <- UserService.prepareMTurkUser(workerId, task.team, task.neededExperience)(GlobalAccessContext)
        annotation <- annotationForAssignment(mturkAssignment, user, task) ?~> Messages("annotation.creationFailed")
      } yield {
        Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
          .withSession(Secured.createSession(user))
      }
  }
}
