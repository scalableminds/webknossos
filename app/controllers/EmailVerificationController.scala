package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.user.EmailVerificationService
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents, PlayBodyParsers}
import security.WkEnv

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class EmailVerificationController @Inject() (
    emailVerificationService: EmailVerificationService,
    sil: Silhouette[WkEnv],
    cc: ControllerComponents
)(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits {

  def verify(key: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      _ <- emailVerificationService.verify(key)(GlobalAccessContext, ec)
    } yield Ok
  }

  def requestVerificationMail: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- emailVerificationService.sendEmailVerification(request.identity)
    } yield Ok
  }
}
