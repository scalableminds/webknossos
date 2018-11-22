package controllers

import akka.util.ByteString
import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.AnnotationDAO
import models.mesh.{MeshDAO, MeshInfo, MeshInfoParameters, MeshService}
import oxalis.security.WkEnv
import play.api.mvc.{AnyContent, PlayBodyParsers, RawBuffer}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class MeshController @Inject()(meshDAO: MeshDAO,
                               annotationDAO: AnnotationDAO,
                               sil: Silhouette[WkEnv],
                               meshService: MeshService)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def get(id: String) = sil.UserAwareAction.async { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      meshInfo <- meshDAO.findOne(idValidated) ?~> "mesh.notFound"
      _ <- annotationDAO.findOne(meshInfo._annotation) ?~> "annotation.notFound"
      meshInfoJs <- meshService.publicWrites(meshInfo) ?~> "mesh.write.failed"
    } yield JsonOk(meshInfoJs)
  }

  def create = sil.SecuredAction.async(validateJson[MeshInfoParameters]) { implicit request =>
    val params = request.body
    val _id = ObjectId.generate
    for {
      _ <- annotationDAO.assertUpdateAccess(params.annotationId) ?~> "notAllowed"
      _ <- meshDAO
        .insertOne(MeshInfo(_id, params.annotationId, params.description, params.position)) ?~> "mesh.create.failed"
      inserted <- meshDAO.findOne(_id) ?~> "mesh.notFound"
      js <- meshService.publicWrites(inserted) ?~> "mesh.write.failed"
    } yield Ok(js)
  }

  def update(id: String) = sil.SecuredAction.async(validateJson[MeshInfoParameters]) { implicit request =>
    val params = request.body
    for {
      idValidated <- ObjectId.parse(id)
      meshInfo <- meshDAO.findOne(idValidated) ?~> "mesh.notFound"
      _ <- annotationDAO.assertUpdateAccess(meshInfo._annotation) ?~> "notAllowed"
      _ <- annotationDAO.assertUpdateAccess(params.annotationId) ?~> "notAllowed"
      _ <- meshDAO
        .updateOne(idValidated, params.annotationId, params.description, params.position) ?~> "mesh.update.failed"
      updated <- meshDAO.findOne(idValidated) ?~> "mesh.notFound"
      js <- meshService.publicWrites(updated) ?~> "mesh.write.failed"
    } yield Ok(js)
  }

  def getData(id: String) = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      meshInfo <- meshDAO.findOne(idValidated) ?~> "mesh.notFound"
      _ <- annotationDAO.findOne(meshInfo._annotation) ?~> "annotation.notFound"
      data <- meshDAO.getData(idValidated) ?~> "mesh.data.get.failed"
    } yield Ok(data)
  }

  def updateData(id: String) = sil.SecuredAction.async(parse.raw) { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      meshInfo <- meshDAO.findOne(idValidated) ?~> "mesh.notFound"
      _ <- annotationDAO.assertUpdateAccess(meshInfo._annotation) ?~> "notAllowed"
      byteString <- request.body.asBytes(maxLength = 1024 * 1024 * 1024) ?~> "mesh.data.read.failed"
      _ <- meshDAO.updateData(idValidated, byteString.toArray) ?~> "mesh.data.save.failed"
    } yield Ok
  }

  def delete(id: String) = sil.SecuredAction.async { implicit request =>
    for {
      idValidated <- ObjectId.parse(id)
      meshInfo <- meshDAO.findOne(idValidated) ?~> "mesh.notFound"
      _ <- annotationDAO.assertUpdateAccess(meshInfo._annotation) ?~> "notAllowed"
      _ <- meshDAO.deleteOne(idValidated) ?~> "mesh.delete.failed"
    } yield Ok
  }

}
