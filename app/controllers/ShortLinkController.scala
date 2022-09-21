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

class ShortLinkController @Inject()(shortLinkDAO: ShortLinkDAO, sil: Silhouette[WkEnv], wkConf: WkConf)(
    implicit ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def create: Action[String] = sil.SecuredAction.async(validateJson[String]) { implicit request =>
    val longLink = request.body
    val _id = ObjectId.generate
    val key = RandomIDGenerator.generateBlocking(12)
    for {
      _ <- bool2Fox(longLink.startsWith(wkConf.Http.uri)) ?~> "Could not generate short link: URI does not match"
      _ <- shortLinkDAO.insertOne(ShortLink(_id, key, longLink)) ?~> "create.failed"
      inserted <- shortLinkDAO.findOne(_id)
    } yield Ok(Json.toJson(inserted))
  }

  def getByKey(key: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      shortLink <- shortLinkDAO.findOneByKey(key)
    } yield Ok(Json.toJson(shortLink))
  }
}
