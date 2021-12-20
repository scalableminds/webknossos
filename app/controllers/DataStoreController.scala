package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import io.swagger.annotations._
import models.binary.{DataStore, DataStoreDAO, DataStoreService, UserDataStoreConfig}
import models.user.MultiUserDAO
import net.liftweb.common.Empty
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

@Api
class DataStoreController @Inject()(
    dataStoreDAO: DataStoreDAO,
    dataStoreService: DataStoreService,
    sil: Silhouette[WkEnv],
    multiUserDAO: MultiUserDAO)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  private val dataStoreReads: Reads[DataStore] =
    ((__ \ 'name).read[String] and
      (__ \ 'url).read[String] and
      (__ \ 'publicUrl).read[String] and
      (__ \ 'key).read[String] and
      (__ \ 'isScratch).readNullable[Boolean] and
      (__ \ 'isForeign).readNullable[Boolean] and
      (__ \ 'isConnector).readNullable[Boolean] and
      (__ \ 'allowsUpload).readNullable[Boolean])(DataStore.fromForm _)

  private val dataStorePublicReads: Reads[DataStore] =
    ((__ \ 'name).read[String] and
      (__ \ 'url).read[String] and
      (__ \ 'publicUrl).read[String] and
      (__ \ 'isScratch).readNullable[Boolean] and
      (__ \ 'isForeign).readNullable[Boolean] and
      (__ \ 'isConnector).readNullable[Boolean] and
      (__ \ 'allowsUpload).readNullable[Boolean])(DataStore.fromUpdateForm _)
  @ApiOperation(value = "List all available datastores", nickname = "datastoreList")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON list of objects containing datastore information"),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def list: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      dataStores <- dataStoreDAO.findAll ?~> "dataStore.list.failed"
      js <- Fox.serialCombined(dataStores)(d => dataStoreService.publicWrites(d))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  @ApiOperation(hidden = true, value = "")
  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataStoreReads) { dataStore =>
      dataStoreDAO.findOneByName(dataStore.name).futureBox.flatMap {
        case Empty =>
          for {
            _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
            _ <- dataStoreDAO.insertOne(dataStore) ?~> "dataStore.create.failed"
            js <- dataStoreService.publicWrites(dataStore)
          } yield { Ok(Json.toJson(js)) }
        case _ => Future.successful(JsonBadRequest(Messages("dataStore.name.alreadyTaken")))
      }
    }
  }

  @ApiOperation(
    value = """Create a new user datastore and get a custom install script to setup the datastore
Expects:
  - As JSON object body with keys:
    - name (string): datastore name
    - url (string): url, where the datastore is reachable
    - port (string): port, where the datastore is reachable (usually 443 for HTTPS)""",
    nickname = "userDatastoreCreation"
  )
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "install script to setup the newly created datastore"),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def createNewUserDataStore: Action[UserDataStoreConfig] = sil.SecuredAction.async(validateJson[UserDataStoreConfig]) {
    implicit request =>
      val dataStore = request.body
      dataStoreDAO.findOneByName(dataStore.name).futureBox.flatMap {
        case Empty =>
          for {
            _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
            installScriptFile <- dataStoreService.createNewUserDataStore(dataStore, request.identity._organization)
          } yield Ok.sendFile(installScriptFile, fileName = _ => Some("install.sh"))
        case _ => Future.successful(JsonBadRequest(Messages("dataStore.name.alreadyTaken")))
      }
  }

  @ApiOperation(value = "Delete a user datastore", nickname = "userDatastoreDeletion")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "Empty body, datastore was removed"),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def deleteUserDataStore(
      @ApiParam(value = "Name of the datastore", required = true) name: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
        dataStore <- dataStoreDAO.findOneByName(name) ?~> "dataStore.notFound" ~> NOT_FOUND
        _ <- bool2Fox(dataStore.onlyAllowedOrganization.contains(request.identity._organization)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- dataStoreDAO.deleteOneByName(name) ?~> "dataStore.remove.failure"
      } yield Ok
    }

  @ApiOperation(value = "Get the install script for an existing user datastore", nickname = "userDatastoreInstall")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "install script to setup the user datastore"),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def getUserDataStore(@ApiParam(value = "Name of the datastore", required = true) name: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
        dataStore <- dataStoreDAO.findOneByName(name) ?~> "dataStore.notFound" ~> NOT_FOUND
        _ <- bool2Fox(dataStore.onlyAllowedOrganization.contains(request.identity._organization)) ?~> "notAllowed" ~> FORBIDDEN
        installScriptFile <- dataStoreService.getUserDataStoreScript(name)
      } yield Ok.sendFile(installScriptFile, fileName = _ => Some("install.sh"))
    }

  @ApiOperation(hidden = true, value = "")
  def delete(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- bool2Fox(multiUser.isSuperUser) ?~> "notAllowed" ~> FORBIDDEN
      _ <- dataStoreDAO.deleteOneByName(name) ?~> "dataStore.remove.failure"
    } yield Ok
  }

  @ApiOperation(hidden = true, value = "")
  def update(name: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataStorePublicReads) { dataStore =>
      for {
        _ <- bool2Fox(request.identity.isAdmin)
        _ <- dataStoreDAO.findOneByName(name) ?~> "dataStore.notFound" ~> NOT_FOUND
        _ <- bool2Fox(dataStore.name == name)
        _ <- dataStoreDAO.updateOne(dataStore) ?~> "dataStore.create.failed"
        js <- dataStoreService.publicWrites(dataStore)
      } yield { Ok(Json.toJson(js)) }
    }
  }
}
