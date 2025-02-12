package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import models.annotation.AnnotationDAO
import models.mesh.{MeshDAO, MeshInfo, MeshInfoParameters, MeshService}
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents, PlayBodyParsers, RawBuffer}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Note that this wk-side controller deals with user-uploaded meshes stored in postgres
// Not to be confused with the DSMeshController that deals with on-disk meshfiles

class MeshController @Inject() (
    meshDAO: MeshDAO,
    annotationDAO: AnnotationDAO,
    sil: Silhouette[WkEnv],
    meshService: MeshService,
    cc: ControllerComponents
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits {

  def get(id: ObjectId): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      meshInfo <- meshDAO.findOne(id) ?~> "mesh.notFound" ~> NOT_FOUND
      _ <- annotationDAO.findOne(meshInfo._annotation) ?~> "annotation.notFound" ~> NOT_FOUND
      meshInfoJs <- meshService.publicWrites(meshInfo) ?~> "mesh.write.failed"
    } yield JsonOk(meshInfoJs)
  }

  def create: Action[MeshInfoParameters] = sil.SecuredAction.async(validateJson[MeshInfoParameters]) {
    implicit request =>
      val params = request.body
      val _id = ObjectId.generate
      for {
        _ <- annotationDAO.assertUpdateAccess(params.annotationId) ?~> "notAllowed" ~> FORBIDDEN
        _ <- meshDAO.insertOne(
          MeshInfo(_id, params.annotationId, params.description, params.position)
        ) ?~> "mesh.create.failed"
        inserted <- meshDAO.findOne(_id) ?~> "mesh.notFound"
        js <- meshService.publicWrites(inserted) ?~> "mesh.write.failed"
      } yield Ok(js)
  }

  def update(id: ObjectId): Action[MeshInfoParameters] = sil.SecuredAction.async(validateJson[MeshInfoParameters]) {
    implicit request =>
      val params = request.body
      for {
        meshInfo <- meshDAO.findOne(id) ?~> "mesh.notFound" ~> NOT_FOUND
        _ <- annotationDAO.assertUpdateAccess(meshInfo._annotation) ?~> "notAllowed" ~> FORBIDDEN
        _ <- annotationDAO.assertUpdateAccess(params.annotationId) ?~> "notAllowed" ~> FORBIDDEN
        _ <- meshDAO.updateOne(id, params.annotationId, params.description, params.position) ?~> "mesh.update.failed"
        updated <- meshDAO.findOne(id) ?~> "mesh.notFound"
        js <- meshService.publicWrites(updated) ?~> "mesh.write.failed"
      } yield Ok(js)
  }

  def getData(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      meshInfo <- meshDAO.findOne(id) ?~> "mesh.notFound" ~> NOT_FOUND
      _ <- annotationDAO.findOne(meshInfo._annotation) ?~> "annotation.notFound" ~> NOT_FOUND
      data <- meshDAO.getData(id) ?~> "mesh.data.get.failed"
    } yield Ok(data)
  }

  def updateData(id: ObjectId): Action[RawBuffer] = sil.SecuredAction.async(parse.raw) { implicit request =>
    for {
      meshInfo <- meshDAO.findOne(id) ?~> "mesh.notFound" ~> NOT_FOUND
      _ <- annotationDAO.assertUpdateAccess(meshInfo._annotation) ?~> "notAllowed" ~> FORBIDDEN
      byteString <- request.body.asBytes(maxLength = 1024 * 1024 * 1024) ?~> "mesh.data.read.failed"
      _ <- meshDAO.updateData(id, byteString.toArray) ?~> "mesh.data.save.failed"
    } yield Ok
  }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      meshInfo <- meshDAO.findOne(id) ?~> "mesh.notFound" ~> NOT_FOUND
      _ <- annotationDAO.assertUpdateAccess(meshInfo._annotation) ?~> "notAllowed" ~> FORBIDDEN
      _ <- meshDAO.deleteOne(id) ?~> "mesh.delete.failed"
    } yield Ok
  }

}
