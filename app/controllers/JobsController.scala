package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.webknossos.datastore.rpc.RPC
import javax.inject.Inject
import oxalis.security.WkEnv
import play.api.libs.json.{JsValue, Json}
import utils.WkConf

import scala.concurrent.ExecutionContext

class JobsController @Inject()(wkConf: WkConf, sil: Silhouette[WkEnv], rpc: RPC)(implicit ec: ExecutionContext)
    extends Controller {

  def list = sil.SecuredAction.async { implicit request =>
    for {
      result <- rpc(s"${wkConf.Jobs.Flower.uri}/api/tasks")
        .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
        .getWithJsonResponse[Map[String, JsValue]]
    } yield Ok(Json.toJson(result))
  }

  def status(id: String) = sil.SecuredAction.async { implicit request =>
    for {
      result <- rpc(s"${wkConf.Jobs.Flower.uri}/api/task/info/$id")
        .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
        .getWithJsonResponse[JsValue]
    } yield Ok(Json.toJson(result))
  }

  def runCubingJob = sil.SecuredAction.async { implicit request =>
    val commandJson = Json.obj(
      "kwargs" -> Json.obj("input_path" -> "data/input/tiff",
                           "output_path" -> "data/output/tiff",
                           "name" -> "sample_tiff",
                           "scale" -> "11.24,11.24,25"))
    for {
      result <- rpc(s"${wkConf.Jobs.Flower.uri}/api/task/async-apply/tasks.tiff_cubing")
        .withBasicAuth(wkConf.Jobs.Flower.username, wkConf.Jobs.Flower.password)
        .postWithJsonResponse[JsValue, Map[String, JsValue]](commandJson)
    } yield Ok(Json.toJson(result))
  }

}
