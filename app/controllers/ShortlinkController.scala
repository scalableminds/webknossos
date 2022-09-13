package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import models.shortlinks.{ShortLink, ShortLinkDAO}
import oxalis.security.{RandomIDGenerator, WkEnv}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class ShortlinkController @Inject()(shortLinkDAO: ShortLinkDAO, sil: Silhouette[WkEnv], wkConf: WkConf)(
    implicit ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def create: Action[String] = sil.SecuredAction.async(validateJson[String]) { implicit request =>
    val longLink = request.body
    val _id = ObjectId.generate
    val shortLink = RandomIDGenerator.generateBlocking(12)
    for {
      _ <- bool2Fox(longLink.startsWith(wkConf.Http.uri)) ?~> "URI does not match"
      _ <- shortLinkDAO.insertOne(ShortLink(_id, shortLink, longLink)) ?~> "create.failed"
      inserted <- shortLinkDAO.findOne(_id)
    } yield Ok(Json.toJson(inserted))
  }

  def getByShortLink(shortLink: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      sl <- shortLinkDAO.findOneByShortLink(shortLink)
    } yield Ok(Json.toJson(sl))
  }
}
