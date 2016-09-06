package controllers

import javax.inject.Inject

import scala.concurrent.Future
import scala.concurrent.duration._

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.tools.Fox
import models.binary._
import models.team.TeamDAO
import models.user.{User, UserService}
import net.liftweb.common.{Failure, Full}
import org.apache.commons.codec.binary.Base64
import org.apache.xalan.res.XSLTErrorResources_pt_BR
import oxalis.ndstore.{ND2WK, NDServerConnection}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.Logger
import play.api.data.validation.ValidationError
import play.api.libs.json._
import play.api.libs.json.Json._
import play.api.libs.functional.syntax._
import play.api.Play.current
import play.api.cache.Cache
import play.api.data.Form
import play.api.data.Forms._
import play.api.i18n.Messages.Message
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.libs.ws.{WS, WSResponse}
import play.api.mvc.BodyParsers.parse
import play.twirl.api.Html
import reactivemongo.api.commands.WriteResult

class DataSetController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  val ThumbnailWidth = 200
  val ThumbnailHeight = 200

  val ThumbnailCacheDuration = 1 day

  val dataSetPublicReads =
    ((__ \ 'description).readNullable[String] and
      (__ \ 'isPublic).read[Boolean]).tupled


  def view(dataSetName: String) = UserAwareAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
    } yield {
      Ok(views.html.main()(Html("")))
    }
  }

  def thumbnail(dataSetName: String, dataLayerName: String) = UserAwareAction.async { implicit request =>

    def imageFromCacheIfPossible(dataSet: DataSet) =
    // We don't want all images to expire at the same time. Therefore, we add a day of randomness, hence the 1 day
      Cache.get(s"thumbnail-$dataSetName*$dataLayerName") match {
        case Some(a: Array[Byte]) =>
          Fox.successful(a)
        case _ =>
          DataStoreHandler.requestDataLayerThumbnail(dataSet, dataLayerName, ThumbnailWidth, ThumbnailHeight).map{
            result =>
              Cache.set(s"thumbnail-$dataSetName*$dataLayerName",
                result,
                (ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds).toInt)
              result
          }
      }



    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      layer <- DataSetService.getDataLayer(dataSet, dataLayerName) ?~> Messages("dataLayer.notFound", dataLayerName)
      image <- imageFromCacheIfPossible(dataSet)
    } yield {
      Ok(image).withHeaders(
        CONTENT_LENGTH -> image.length.toString,
        CONTENT_TYPE -> play.api.libs.MimeTypes.forExtension("jpeg").getOrElse(play.api.http.ContentTypes.BINARY)
      )
    }
  }

  def empty = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  // TODO: find a better way to ignore parameters
  def emptyWithWildcard(param: String) = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def userAwareEmpty = UserAwareAction { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def list = UserAwareAction.async { implicit request =>
    UsingFilters(
      Filter("isEditable", (value: Boolean, el: DataSet) =>
        el.isEditableBy(request.userOpt) && value || !el.isEditableBy(request.userOpt) && !value),
      Filter("isActive", (value: Boolean, el: DataSet) =>
        el.isActive == value)
    ) { filter =>
      DataSetDAO.findAll.map {
        dataSets =>
          Ok(Writes.list(DataSet.dataSetPublicWrites(request.userOpt)).writes(filter.applyOn(dataSets)))
      }
    }
  }

  def accessList(dataSetName: String) = Authenticated.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      users <- UserService.findByTeams(dataSet.allowedTeams, includeAnonymous = false)
    } yield {
      Ok(Writes.list(User.userCompactWrites).writes(users))
    }
  }

  def read(dataSetName: String) = UserAwareAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
    } yield {
      Ok(DataSet.dataSetPublicWrites(request.userOpt).writes(dataSet))
    }
  }

  def update(dataSetName: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataSetPublicReads) {
      case (description, isPublic) =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- allowedToAdministrate(request.user, dataSet)
        updatedDataSet <- DataSetService.update(dataSet, description, isPublic)
      } yield {
        Ok(DataSet.dataSetPublicWrites(request.userOpt).writes(updatedDataSet))
      }
    }
  }


  def importDataSet(dataSetName: String) = Authenticated.async { implicit request =>
    for {
      _ <- DataSetService.isProperDataSetName(dataSetName) ?~> Messages("dataSet.import.impossible.name")
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      result <- DataSetService.importDataSet(dataSet)
    } yield {
      val status = result.status.toIntOpt.getOrElse(INTERNAL_SERVER_ERROR)
      Status(status)(result.body)
    }
  }

  def importProgress(dataSetName: String) = Authenticated.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)
      result <- DataStoreHandler.progressForImport(dataSet)
    } yield {
      val status = result.status.toIntOpt.getOrElse(INTERNAL_SERVER_ERROR)
      Status(status)(result.body)
    }
  }

  def updateTeams(dataSetName: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyAs[List[String]] { teams =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        _ <- allowedToAdministrate(request.user, dataSet)
        userTeams <- TeamDAO.findAll.map(_.filter(team => team.isEditableBy(request.user)))
        teamsWithoutUpdate = dataSet.allowedTeams.filterNot(t => userTeams.exists(_.name == t))
        teamsWithUpdate = teams.filter(t => userTeams.exists(_.name == t))
        _ <- DataSetService.updateTeams(dataSet, teamsWithUpdate ++ teamsWithoutUpdate)
      } yield
      Ok(Json.toJson(teamsWithUpdate ++ teamsWithoutUpdate))
    }
  }

  def uploadForm = Form(
    tuple(
      "name" -> nonEmptyText.verifying("dataSet.name.invalid",
        n => DataSetService.isProperDataSetName(n)),
      "team" -> nonEmptyText,
      "scale" -> mapping(
        "scale" -> text.verifying("scale.invalid",
          p => p.matches(Scale.formRx.toString)))(Scale.fromForm)(Scale.toForm)
    )).fill(("", "", Scale.default))

  def upload = Authenticated.async(parse.multipartFormData) { implicit request =>
    uploadForm.bindFromRequest(request.body.dataParts).fold(
      hasErrors =
        formWithErrors => Future.successful(JsonBadRequest(formWithErrors.errors.head.message)),
      success = {
        case (name, team, scale) =>
          for {
            _ <- checkIfNewDataSetName(name) ?~> Messages("dataSet.name.alreadyTaken")
            _ <- ensureTeamAdministration(request.user, team)
            zipFile <- request.body.file("zipFile") ?~> Messages("zip.file.notFound")
            settings = DataSourceSettings(None, scale, None)
            upload = DataSourceUpload(name, team, zipFile.ref.file.getAbsolutePath, Some(settings))
            _ <- DataStoreHandler.uploadDataSource(upload)
          } yield {
            JsonOk(Messages("dataSet.upload.success"))
          }
      })
  }

  private def checkIfNewDataSetName(name: String)(implicit ctx: DBAccessContext) = {
    DataSetService.findDataSource(name)(GlobalAccessContext).reverse
  }

  val externalDataSetFormReads =
    ((__ \ 'server).read[String] and
      (__ \ 'name).read[String] and
      (__ \ 'token).read[String] and
      (__ \ 'team).read[String]).tupled

  private def createNDStoreDataSet(implicit request: AuthenticatedRequest[JsValue]) =
    withJsonBodyUsing(externalDataSetFormReads){
      case (server, name, token, team) =>
        for {
          _ <- checkIfNewDataSetName(name) ?~> Messages("dataSet.name.alreadyTaken")
          _ <- ensureTeamAdministration(request.user, team)
          ndProject <- NDServerConnection.requestProjectInformationFromNDStore(server, name, token)
          dataSet <- ND2WK.dataSetFromNDProject(ndProject, team)
          _ <-  DataSetDAO.insert(dataSet)(GlobalAccessContext)
        } yield JsonOk(Messages("dataSet.create.success"))
    }

  def create(typ: String) = Authenticated.async(parse.json) { implicit request =>
    typ match {
      case "ndstore" =>
        createNDStoreDataSet(request)
      case _ =>
        Future.successful(JsonBadRequest(Messages("dataSet.type.invalid", typ)))
    }
  }

}
