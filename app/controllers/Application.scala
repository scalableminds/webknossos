package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.config.ConfigRenderOptions
import javax.inject.Inject
import models.analytics.{AnalyticsService, FrontendAnalyticsEvent}
import models.binary.DataStoreRpcClient
import models.user.{MultiUserDAO, User}
import oxalis.security.WkEnv
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import slick.jdbc.PostgresProfile.api._
import utils.{SQLClient, SimpleSQLDAO, StoreModules, WkConf}

import scala.concurrent.ExecutionContext

class Application @Inject()(multiUserDAO: MultiUserDAO,
                            analyticsService: AnalyticsService,
                            releaseInformationDAO: ReleaseInformationDAO,
                            conf: WkConf,
                            storeModules: StoreModules,
                            sil: Silhouette[WkEnv],
                            rpc: RPC)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def buildInfo: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      schemaVersion <- releaseInformationDAO.getSchemaVersion.futureBox
      token <- webKnossosToken(request.identity)
    } yield {
      Ok(
        Json.obj(
          "webknossos" -> webknossos.BuildInfo.toMap.mapValues(_.toString),
          "webknossos-wrap" -> webknossoswrap.BuildInfo.toMap.mapValues(_.toString),
          "schemaVersion" -> schemaVersion.toOption,
          "token" -> token,
          "localDataStoreEnabled" -> storeModules.localDataStoreEnabled,
          "localTracingStoreEnabled" -> storeModules.localTracingStoreEnabled
        ))
    }
  }

  private def webKnossosToken(issuingUserOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Option[String]] =
    issuingUserOpt match {
      case Some(user) =>
        for {
          multiUser <- multiUserDAO.findOne(user._multiUser)
        } yield if (multiUser.isSuperUser) Some(DataStoreRpcClient.webKnossosToken) else None
      case _ => Fox.successful(None)
    }

  def trackAnalyticsEvent(eventType: String): Action[JsObject] = sil.UserAwareAction(validateJson[JsObject]) {
    implicit request =>
      request.identity.foreach { user =>
        analyticsService.track(FrontendAnalyticsEvent(user, eventType, request.body))
      }
      Ok
  }

  def features: Action[AnyContent] = sil.UserAwareAction {
    Ok(conf.raw.underlying.getConfig("features").resolve.root.render(ConfigRenderOptions.concise()))
  }

  def health: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    def checkDatastoreHealthIfEnabled: Fox[Option[Long]] =
      if (storeModules.localDataStoreEnabled) {
        for {
          before <- Fox.successful(System.currentTimeMillis())
          response <- rpc(s"http://localhost:${conf.Http.port}/data/health").get
          if response.status == 200
          after = System.currentTimeMillis()
        } yield Some(after - before)
      } else Fox.successful(None)

    def checkTracingstoreHealthIfEnabled: Fox[Option[Long]] =
      if (storeModules.localTracingStoreEnabled) {
        for {
          before <- Fox.successful(System.currentTimeMillis())
          response <- rpc(s"http://localhost:${conf.Http.port}/tracings/health").get
          if response.status == 200
          after = System.currentTimeMillis()
        } yield Some(after - before)
      } else Fox.successful(None)

    def logDuration(before: Long, dataStoreDuration: Option[Long], tracingStoreDuration: Option[Long]): Unit = {
      val dataStoreLabel = dataStoreDuration.map(dd => s"local Datastore $dd ms")
      val tracingStoreLabel = tracingStoreDuration.map(td => s"local Tracingstore $td ms")
      val localStoresLabel = List(dataStoreLabel, tracingStoreLabel).flatten.mkString(", ")
      val localStoresLabelWrapped = if (localStoresLabel.isEmpty) "" else s" ($localStoresLabel)"
      val after = System.currentTimeMillis()
      logger.info(s"Answering ok for wK health check, took ${after - before} ms$localStoresLabelWrapped")
    }
    log() {
      for {
        before <- Fox.successful(System.currentTimeMillis())
        dataStoreDuration <- checkDatastoreHealthIfEnabled ?~> "dataStore.unavailable"
        tracingStoreDuration <- checkTracingstoreHealthIfEnabled ?~> "tracingStore.unavailable"
        _ = logDuration(before, dataStoreDuration, tracingStoreDuration)
      } yield Ok
    }
  }

}

class ReleaseInformationDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient)
    with FoxImplicits {
  def getSchemaVersion(implicit ec: ExecutionContext): Fox[Int] =
    for {
      rList <- run(sql"select schemaVersion from webknossos.releaseInformation".as[Int])
      r <- rList.headOption.toFox
    } yield r
}
