package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import models.ShortLinkService
import models.{ShortLink, ShortLinkDAO}
import oxalis.security.{RandomIDGenerator, WkEnv}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class ShortlinkController @Inject()(
    shortLinkDAO: ShortLinkDAO,
    shortLinkService: ShortLinkService,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def create: Action[String] = sil.SecuredAction.async(validateJson[String]) { implicit request =>
    val longLink = request.body
    val _id = ObjectId.generate
    val shortLink = RandomIDGenerator.generateBlocking(12)
    for {
      _ <- shortLinkDAO.insertOne(ShortLink(_id, shortLink, longLink)) ?~> "create.failed"
      inserted <- shortLinkDAO.findOne(_id)
      js <- shortLinkService.toJson(inserted)
    } yield Ok(js)
  }

  def get(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.fromString(id)
      shortLink <- shortLinkDAO.findOne(idValidated)
      js <- shortLinkService.toJson(shortLink)
    } yield Ok(js)
  }

  def get_by_value(shortLink: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      sl <- shortLinkDAO.findOneByShortLink(shortLink)
      js <- shortLinkService.toJson(sl)
    } yield Ok(js)
  }
}
