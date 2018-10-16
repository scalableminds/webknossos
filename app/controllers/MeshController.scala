package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.mesh.MeshDAO
import oxalis.security.WkEnv
import play.api.mvc.PlayBodyParsers
import utils.ObjectId

import scala.concurrent.ExecutionContext


class MeshController @Inject()(meshDao: MeshDAO,
                               sil: Silhouette[WkEnv])
                              (implicit ec: ExecutionContext,
                               bodyParsers: PlayBodyParsers)
  extends Controller
    with FoxImplicits {

  def get(id: String) = sil.UserAwareAction.async { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      mesh <- meshDao.findOne(idValidated)
    } yield Ok(mesh.data)
  }

  def create = sil.SecuredAction.async { implicit request =>
    for {
      _ <- Fox.successful(())
    } yield Ok
  }

}
