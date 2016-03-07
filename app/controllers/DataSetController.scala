package controllers

import javax.inject.Inject

import scala.concurrent.Future
import scala.concurrent.duration._

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.DefaultConverters._
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import models.binary._
import models.team.TeamDAO
import models.user.{User, UserService}
import net.liftweb.common.{Failure, Full}
import org.apache.commons.codec.binary.Base64
import oxalis.security.Secured
import play.api.Play.current
import play.api.cache.Cache
import play.api.data.Form
import play.api.data.Forms._
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.twirl.api.Html

class DataSetController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  val ThumbnailWidth = 200
  val ThumbnailHeight = 200

  val ThumbnailCacheDuration = 1 day

  def view(dataSetName: String) = UserAwareAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
    } yield {
      Ok(views.html.main()(Html("")))
    }
  }

  def thumbnail(dataSetName: String, dataLayerName: String) = UserAwareAction.async { implicit request =>

    def imageFromCacheIfPossible(dataSet: DataSet) =
    // We don't want all images to expire at the same time. Therefore, we add a day of randomness, hence the 86400
      Cache.getOrElse(s"thumbnail-$dataSetName*$dataLayerName",
        ThumbnailCacheDuration.toSeconds.toInt + (math.random * 86400).toInt) {
        DataStoreHandler.requestDataLayerThumbnail(dataSet, dataLayerName, ThumbnailWidth, ThumbnailHeight)
      }

    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      layer <- DataSetService.getDataLayer(dataSet, dataLayerName) ?~> Messages("dataLayer.notFound")
      image <- imageFromCacheIfPossible(dataSet) ?~> Messages("dataLayer.thumbnailFailed")
    } yield {
      val data = Base64.decodeBase64(image)
      Ok(data).withHeaders(
        CONTENT_LENGTH -> data.length.toString,
        CONTENT_TYPE -> play.api.libs.MimeTypes.forExtension("jpeg").getOrElse(play.api.http.ContentTypes.BINARY)
      )
    }
  }

  def empty = Authenticated { implicit request =>
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
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      users <- UserService.findByTeams(dataSet.allowedTeams)
    } yield {
      Ok(Writes.list(User.userCompactWrites(request.user)).writes(users))
    }
  }

  def read(dataSetName: String) = UserAwareAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
    } yield {
      Ok(DataSet.dataSetPublicWrites(request.userOpt).writes(dataSet))
    }
  }

  def importDataSet(dataSetName: String) = Authenticated.async { implicit request =>
    for {
      _ <- DataSetService.isProperDataSetName(dataSetName) ?~> Messages("dataSet.import.impossible.name")
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
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
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
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
      hasErrors = (formWithErrors => Future.successful(JsonBadRequest(formWithErrors.errors.head.message))),
      success = {
        case (name, team, scale) =>
          (for {
            _ <- checkIfNewDataSetName(name) ?~> Messages("dataSet.name.alreadyTaken")
            _ <- ensureTeamAdministration(request.user, team)
            zipFile <- request.body.file("zipFile").toFox ~> Messages("zip.file.notFound")
            settings = DataSourceSettings(None, scale, None)
            upload = DataSourceUpload(name, team, zipFile.ref.file.getAbsolutePath, Some(settings))
            _ <- DataStoreHandler.uploadDataSource(upload)
          } yield {
              Ok(Json.obj())
            }).futureBox.map {
            case Full(r)              => r
            case Failure(error, _, _) =>
              JsonBadRequest(error)
          }
      })
  }

  private def checkIfNewDataSetName(name: String)(implicit ctx: DBAccessContext) = {
    DataSetService.findDataSource(name)(GlobalAccessContext).reverse
  }

}
