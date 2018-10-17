package controllers

import akka.util.ByteString
import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.mesh.{MeshDAO, MeshInfo, MeshInfoParameters, MeshService}
import oxalis.security.WkEnv
import play.api.mvc.{AnyContent, PlayBodyParsers, RawBuffer}
import utils.ObjectId

import scala.concurrent.ExecutionContext


class MeshController @Inject()(meshDAO: MeshDAO,
                               sil: Silhouette[WkEnv],
                               meshService: MeshService
                              )
                              (implicit ec: ExecutionContext,
                               bodyParsers: PlayBodyParsers)
  extends Controller
    with FoxImplicits {

  def get(id: String) = sil.UserAwareAction.async { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      meshInfo <- meshDAO.findOne(idValidated)
      meshInfoJs <- meshService.publicWrites(meshInfo)
    } yield JsonOk(meshInfoJs)
  }

  def create = sil.SecuredAction.async(validateJson[MeshInfoParameters]) { implicit request =>
    val params = request.body
    val _id = ObjectId.generate
    for {
      //TODO: is the annotation id validated?
      _ <- meshDAO.insertOne(MeshInfo(_id, params.annotationId, params.description, params.position))
      inserted <- meshDAO.findOne(_id)
      js <- meshService.publicWrites(inserted)
    } yield Ok(js)
  }

  def update(id: String) = sil.SecuredAction.async(validateJson[MeshInfoParameters]) { implicit request =>
    val params = request.body
    for {
      idValidated <- ObjectId.parse(id)
      _ <- meshDAO.updateOne(idValidated, params.annotationId, params.description, params.position)
      updated <- meshDAO.findOne(idValidated)
      js <- meshService.publicWrites(updated)
    } yield Ok(js)
  }

  def getData(id: String) = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      data <- meshDAO.getData(idValidated)
    } yield Ok(data)
  }

  def updateData(id: String) = sil.SecuredAction.async(parse.raw) { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      byteString <- request.body.asBytes(maxLength = 1024*1024*1024) ?~> "asBytes failed"
      array = byteString.toArray
      _ <- meshDAO.updateData(idValidated, array)
    } yield Ok
  }

  def delete(id: String)  = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      _ <- meshDAO.deleteOne(idValidated)
    } yield Ok
  }

}
