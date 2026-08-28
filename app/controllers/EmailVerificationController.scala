package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import models.user.EmailVerificationService
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class EmailVerificationController @Inject() (
    emailVerificationService: EmailVerificationService,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller {

  def verify(key: String): Action[AnyContent] = Action.fox { _ =>
    for {
      _ <- emailVerificationService.verify(key)(using GlobalAccessContext, ec)
    } yield Ok
  }

  def requestVerificationMail: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- emailVerificationService.sendEmailVerification(request.identity)
    } yield Ok
  }
}
