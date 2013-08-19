package controllers.levelcreator

import views.html
import braingames.mvc._
import models.knowledge._
import play.api.Play.current
import play.api.mvc.{RequestHeader, Action}
import play.api.data._
import play.api.data.Forms._
import play.api.i18n.Messages
import play.api.libs.json._
import play.api._
import java.io.File
import scala.util.Failure
import braingames.binary.models.DataSet
import braingames.util.ExtendedTypes.ExtendedString
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.templates.Html
import braingames.reactivemongo.GlobalDBAccess
import play.api.i18n.Messages.Message
import play.api.libs.concurrent.Akka
import akka.pattern.ask
import scala.concurrent.duration._
import braingames.levelcreator.{QueueStatus, QueueStatusRequest, StackWorkDistributor}
import akka.util.Timeout
import net.liftweb.common.Full

object LevelCreator extends LevelCreatorController with GlobalDBAccess {

  lazy val stackWorkDistributor = Akka.system.actorFor(s"user/${StackWorkDistributor.name}")

  val levelForm = Form(
    mapping(
      "name" -> text.verifying("level.invalidName", Level.isValidLevelName _),
      "game" -> nonEmptyText,
      "width" -> number,
      "height" -> number,
      "slides before problem" -> number,
      "slides after problem" -> number,
      "dataset" -> text)(
      Level.fromForm)(Level.toForm)).fill(Level.empty)

  def useRandom(levelId: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Async {
        for {
          mission <- MissionDAO.randomByDataSetName(request.level.dataSetName) ?~> Messages("mission.notFound")
        } yield {
          Ok(html.levelcreator.levelCreator(request.level, mission))
        }
      }
  }

  def use(levelId: String, missionId: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Async {
        for {
          mission <- MissionDAO.findOneById(missionId) ?~> Messages("mission.notFound")
        } yield {
          Ok(html.levelcreator.levelCreator(request.level, mission))
        }
      }
  }

  def delete(levelId: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Async {
        LevelDAO.removeById(request.level.id).map {
          e =>
            if (e.ok)
              JsonOk(Messages("level.removed"))
            else
              JsonOk(Messages("level.remove.failed"))
        }
      }
  }

  def submitCode(levelId: String) = ActionWithValidLevel(levelId, parse.urlFormEncoded) {
    implicit request =>
      Async {
        for {
          code <- postParameter("code") ?~> Messages("level.code.notSupplied")
          updatedLevel <- LevelDAO.createNewVersion(request.level, code)
        } yield {
          JsonOk(
            Json.obj(
              "newId" -> updatedLevel.id,
              "newName" -> updatedLevel.levelId.toBeautifiedString), "level.code.saved")
        }
      }
  }

  def uploadAsset(levelId: String) = ActionWithValidLevel(levelId, parse.multipartFormData) {
    implicit request =>
      Async {
        for {
          assetFile <- request.body.file("asset") ?~> Messages("level.assets.notSupplied")
          _ <- LevelDAO.addAssetToLevel(request.level, assetFile.filename, assetFile.ref.file) ?~> Messages("level.assets.uploadFailed")
        } yield {
          JsonOk(Messages("level.assets.uploaded"))
        }
      }
  }

  def listAssets(levelId: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Ok(Json.toJson(request.level.assets.map(_.accessName)))
  }

  def retrieveAsset(levelId: String, asset: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      for {
        assetFile <- request.level.retrieveAsset(asset) ?~ Messages("level.assets.notFound")
      } yield {
        Ok.sendFile(assetFile, true)
      }
  }

  def deleteAsset(levelId: String, asset: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Async {
        for {
          _ <- LevelDAO.removeAssetFromLevel(request.level, asset) ?~> Messages("level.assets.deleteFailed")
        } yield {
          JsonOk(Messages("level.assets.deleted"))
        }
      }
  }

  def create = Action(parse.urlFormEncoded) {
    implicit request =>
      Async {
        levelForm.bindFromRequest.fold(
          formWithErrors =>
            generateLevelList(formWithErrors).map(BadRequest.apply[Html]), //((taskCreateHTML(taskFromTracingForm, formWithErrors)), {
          t => {
            (for {
              dataSet <- DataSetDAO.findOneByName(t.dataSetName) ?~> Messages("dataSet.notFound")
              game <- GameDAO.findOneByName(t.game) ?~> Messages("game.notFound")
              existingLevelWithSameName <- LevelDAO.createLevel(t) ?~> Messages("level.create.failed")
              form <- generateLevelList(levelForm)
            } yield {
              Ok(form)
            }).map(s => s)
          }
        )
      }
  }

  def requestQueueStatus() = {
    implicit val timeout = Timeout(5 seconds)
    (stackWorkDistributor ? QueueStatusRequest).mapTo[QueueStatus].map {
      queueStatus =>
        queueStatus.levelStats
    }
  }

  def requestQueueStatusFor(levelId: LevelId) = {
    requestQueueStatus().map(_.get(levelId).getOrElse(0))
  }

  def progress(levelName: String) = Action {
    implicit request =>
      Async {
        for {
          level <- LevelDAO.findLatestOneByName(levelName) ?~> Messages("level.notFound")
          stacksInQueued <- requestQueueStatusFor(level.levelId)
          stacksInProgress <- StackInProgressDAO.countFor(level.levelId)
        } yield {
          Ok(html.levelcreator.levelGenerationProgress(level.numberOfActiveStacks, stacksInQueued, stacksInProgress))
        }
      }
  }

  def updateRenderSettings(levelId: String) = ActionWithValidLevel(levelId, parser = parse.json) {
    implicit request =>
      Async {
        for {
          settings <- request.body.asOpt[RenderSettings] ?~> Messages("level.render.invalidSettings")
          _ <- LevelDAO.updateRenderSettings(request.level, settings)
        } yield {

          if(settings.shouldBeShipped){
            ActiveLevelDAO.addActiveLevel(request.level.game, request.level.levelId)
          } else {
            ActiveLevelDAO.removeActiveLevel(request.level.game, request.level.levelId)
          }

          val shippingMessage =
            if (settings.shouldBeShipped)
              Messages("level.render.shippingActive")
            else
              Messages("level.render.shippingInactive")

          val autoRenderMessage =
            if (settings.shouldAutoRender)
              Messages("level.render.autoRenderActive")
            else
              Messages("level.render.autoRenderInactive")

          JsonOk(shippingMessage + " " + autoRenderMessage)
        }
      }
  }

  def generateLevelList(levelForm: Form[Level])(implicit request: RequestHeader): Future[Html] = {
    WorkController.countActiveRenderers.flatMap {
      rendererCount =>
        for {
          dataSets <- DataSetDAO.findWithTyp("segmentation")(ctx)
          games <- GameDAO.findAll(ctx)
          latestLevels <- LevelDAO.findAllLatest
          shippedLevels <- LevelDAO.findAllShipped
          levels = latestLevels ::: shippedLevels
          stacksInQueue <- requestQueueStatus()
          stacksInProgress <- StackInProgressDAO.findAll.map(_.groupBy(_.levelId).mapValues(_.size))
        } yield {
          html.levelcreator.levelList(shippedLevels, latestLevels, levelForm, dataSets, games, stacksInProgress, stacksInQueue, rendererCount)
        }
    }
  }

  def list = Action {
    implicit request =>
      Async {
        generateLevelList(levelForm).map(Ok.apply[Html])
      }
  }
}