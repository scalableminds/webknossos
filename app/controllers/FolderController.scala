package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.objectid.ObjectId
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox
import models.dataset.DatasetDAO
import models.folder.{Folder, FolderDAO, FolderParameters, FolderService}
import models.organization.OrganizationDAO
import models.team.{TeamDAO, TeamService}
import models.user.UserService
import play.api.libs.json.{JsArray, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv
import utils.MetadataAssertions

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FolderController @Inject() (
    folderDAO: FolderDAO,
    folderService: FolderService,
    teamDAO: TeamDAO,
    userService: UserService,
    teamService: TeamService,
    datasetDAO: DatasetDAO,
    organizationDAO: OrganizationDAO,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with MetadataAssertions {

  def getRoot: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      rootFolder <- folderDAO.findOne(organization._rootFolder)
      rootFolderJson <- folderService.publicWrites(rootFolder, Some(request.identity), Some(organization))
    } yield Ok(rootFolderJson)
  }

  def get(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      folder <- folderDAO.findOne(id) ?~> Msg.Folder.notFound
      organization <- organizationDAO.findOne(request.identity._organization)
      folderJson <- folderService.publicWrites(folder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

  def update(id: ObjectId): Action[FolderParameters] = sil.SecuredAction.fox(validateJson[FolderParameters]) {
    implicit request =>
      for {
        _ <- Fox.successful(())
        params = request.body
        organization <- organizationDAO.findOne(request.identity._organization)
        _ <- folderDAO.findOne(id) ?~> Msg.Folder.notFound
        _ <- Fox.assertTrue(folderDAO.isEditable(id)) ?~> Msg.Folder.updateNotAllowed ~> FORBIDDEN
        _ <- folderService.assertValidFolderName(params.name)
        _ <- assertNoDuplicateMetadataKeys(params.metadata)
        _ <- folderDAO.updateMetadata(id, params.metadata)
        _ <- folderDAO.updateName(id, params.name) ?~> Msg.Folder.updateNameFailed
        _ <- folderService.updateAllowedTeams(
          id,
          params.allowedTeams,
          request.identity
        ) ?~> Msg.Folder.updateTeamsFailed
        updated <- folderDAO.findOne(id)
        folderJson <- folderService.publicWrites(updated, Some(request.identity), Some(organization))
      } yield Ok(folderJson)
  }

  def move(id: ObjectId, newParentId: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      _ <- Fox.fromBool(organization._rootFolder != id) ?~> Msg.Folder.moveRoot
      _ <- Fox.fromBool(newParentId != id) ?~> Msg.Folder.moveSelf
      _ <- folderDAO.findOne(id) ?~> Msg.Folder.notFound
      _ <- folderDAO.findOne(newParentId) ?~> Msg.Folder.notFound
      _ <- folderDAO.moveSubtree(id, newParentId)
      updated <- folderDAO.findOne(id)
      folderJson <- folderService.publicWrites(updated, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      _ <- Fox.fromBool(organization._rootFolder != id) ?~> Msg.Folder.deleteRoot
      _ <- folderDAO.findOne(id) ?~> Msg.Folder.notFound
      childrenCount <- folderDAO.countChildren(id)
      datasetsCount <- datasetDAO.countByFolder(id)
      _ <- Fox.fromBool(childrenCount == 0) ?~> Msg.Folder.deleteNotEmptyChildren
      _ <- Fox.fromBool(datasetsCount == 0) ?~> Msg.Folder.deleteNotEmptyDatasets
      _ <- folderDAO.deleteOne(id)
    } yield Ok
  }

  def getTree: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      organization <- organizationDAO.findOne(request.identity._organization)
      foldersWithParents <- folderDAO.findTreeOf(organization._rootFolder)
      allEditableIds <- folderDAO.findAllEditableIds
      allEditableIdsSet = allEditableIds.toSet
      foldersWithParentsJson = foldersWithParents.map(f => folderService.publicWritesWithParent(f, allEditableIdsSet))
    } yield Ok(Json.toJson(foldersWithParentsJson))
  }

  def create(parentId: ObjectId, name: String): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      _ <- folderService.assertValidFolderName(name)
      newFolder = Folder(ObjectId.generate, name, JsArray.empty)
      _ <- folderDAO.findOne(parentId) ?~> Msg.Folder.notFound
      _ <- folderDAO.insertAsChild(parentId, newFolder) ?~> Msg.Folder.createFailed
      organization <- organizationDAO.findOne(request.identity._organization) ?~> Msg.Folder.notFound
      folderJson <- folderService.publicWrites(newFolder, Some(request.identity), Some(organization))
    } yield Ok(folderJson)
  }

}
