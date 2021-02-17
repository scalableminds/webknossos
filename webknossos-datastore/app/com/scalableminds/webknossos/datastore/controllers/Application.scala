package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.webknossos.datastore.DataStoreConfig
import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.{ExecutionContext, Future}

class Application @Inject()(dataStoreConfig: DataStoreConfig)(implicit executionContext: ExecutionContext)
    extends Controller {

  def health: Action[AnyContent] = Action.async { implicit request =>
    AllowRemoteOrigin {
      for {
        _ <- Future.successful(
          logger.info(
            s"sleeping health check, request ${request.toString()}, thread ${Thread.currentThread().getId}..."))
        _ <- Future.successful(Thread.sleep(dataStoreConfig.Datastore.healthSleep.toMillis))
        _ <- Future.successful(
          logger.info(
            s"done sleeping health check, request ${request.toString()}, thread ${Thread.currentThread().getId}..."))
      } yield Ok("Ok")
    }
  }

  def testGet: Action[AnyContent] = Action.async { implicit request =>
    AllowRemoteOrigin {
      for {
        _ <- Future.successful(
          logger.info(s"sleeping, request ${request.toString()}, thread ${Thread.currentThread().getId}..."))
        _ <- Future.successful(Thread.sleep(dataStoreConfig.Datastore.testGetSleep.toMillis))
        _ <- Future.successful(
          logger.info(s"done sleeping, request ${request.toString()}, thread ${Thread.currentThread().getId}."))
      } yield Ok("TestGet Ok")
    }
  }

  def testGetBusy: Action[AnyContent] = Action.async { implicit request =>
    AllowRemoteOrigin {
      for {
        _ <- Future.successful(
          logger.info(s"busy waiting, request ${request.toString()}, thread ${Thread.currentThread().getId}..."))
        _ <- Future.successful(busyWait(dataStoreConfig.Datastore.testGetBusyWait.toNanos))
        _ <- Future.successful(
          logger.info(s"done busy waiting, request ${request.toString()}, thread ${Thread.currentThread().getId}."))
      } yield Ok("TestGet Busy Ok")
    }
  }

  private def busyWait(nanosec: Long): Unit = {
    @scala.annotation.tailrec
    def wait(target: Long, now: Long): Unit =
      if (target >= now) {
        wait(target, System.nanoTime)
      }
    val now = System.nanoTime
    wait(now + nanosec, now)
  }

}
