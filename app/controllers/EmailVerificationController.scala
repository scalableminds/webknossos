package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.FoxImplicits
import io.swagger.annotations.ApiOperation
import models.user.{EmailVerificationService, MultiUserDAO}
import oxalis.security.WkEnv
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class EmailVerificationController @Inject()(
    emailVerificationService: EmailVerificationService,
    multiUserDAO: MultiUserDAO,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  @ApiOperation(value = "")
  def verify(key: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      _ <- emailVerificationService.verify(key)(GlobalAccessContext, ec)
    } yield Ok
  }

  @ApiOperation(value = "")
  def requestVerificationMail: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- emailVerificationService.sendEmailVerification(request.identity)
    } yield Ok
  }
}
