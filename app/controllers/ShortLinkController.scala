package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import io.swagger.annotations.{Api, ApiOperation, ApiParam}
import models.shortlinks.{ShortLink, ShortLinkDAO}
import oxalis.security.{RandomIDGenerator, WkEnv}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

@Api
class ShortLinkController @Inject()(shortLinkDAO: ShortLinkDAO, sil: Silhouette[WkEnv], wkConf: WkConf)(
    implicit ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  @ApiOperation(hidden = true, value = "")
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

  @ApiOperation(value = "Information about a short link, including the original long link.",
                nickname = "shortLinkByKey")
  def getByKey(
      @ApiParam(value = "key of the shortLink, this is the short random string identifying the link.",
                example = "aU7yv5Aja99T0829")
      key: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      shortLink <- shortLinkDAO.findOneByKey(key)
    } yield Ok(Json.toJson(shortLink))
  }
}
