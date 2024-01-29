package models.analytics

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.bool2Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.user.{MultiUserDAO, UserDAO}
import play.api.libs.json._
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class AnalyticsService @Inject()(rpc: RPC,
                                 wkConf: WkConf,
                                 analyticsLookUpService: AnalyticsLookUpService,
                                 analyticsSessionService: AnalyticsSessionService,
                                 analyticsDAO: AnalyticsDAO)(implicit ec: ExecutionContext)
    extends LazyLogging {

  private lazy val conf = wkConf.BackendAnalytics
  private lazy val wellKnownUris = conf.wellKnownUris.map(_.split("\\|")).map(parts => (parts(0), parts(1))).toMap

  def track(analyticsEvent: AnalyticsEvent): Unit = {
    for {
      sessionId <- Fox.successful(analyticsSessionService.refreshAndGetSessionId(analyticsEvent.user._multiUser))
      analyticsJson <- analyticsEvent.toJson(analyticsLookUpService, sessionId)
      _ <- saveInDatabase(List(analyticsJson))
      _ <- send(Json.toJsObject(analyticsJson))
    } yield ()
    () // Do not return the Future, so as to not block caller
  }

  def ingest(jsonEvents: List[AnalyticsEventJson], apiKey: String): Fox[Unit] = {
    val allApiKeysAreOk = !jsonEvents.exists(ev => {
      wellKnownUris.get(ev.userProperties.webknossosUri).exists(wellKnownApiKey => wellKnownApiKey != apiKey)
    })
    for {
      _ <- bool2Fox(allApiKeysAreOk) ?~> "Provided API key is not correct for provided webknossosUri"
      _ <- analyticsDAO.insertMany(jsonEvents)
    } yield ()
  }

  private def send(analyticsEventJson: JsObject): Fox[Unit] = {
    if (conf.uri == "") {
      if (conf.verboseLoggingEnabled) {
        logger.info(s"Not sending analytics event, since uri is not configured. Event was: $analyticsEventJson")
      }
    } else {
      if (conf.verboseLoggingEnabled) {
        logger.info(s"Sending analytics event: $analyticsEventJson")
      }
      val wrappedJson = Json.obj("api_key" -> conf.key, "events" -> List(analyticsEventJson))
      rpc(conf.uri).silent.postJson(wrappedJson)
    }
    Fox.successful(())
  }

  private def saveInDatabase(events: List[AnalyticsEventJson]): Fox[Unit] = {
    if (conf.databaseEnabled) {
      analyticsDAO.insertMany(events)
    }
    Fox.successful(())
  }
}

class AnalyticsLookUpService @Inject()(userDAO: UserDAO, multiUserDAO: MultiUserDAO, wkConf: WkConf)
    extends LazyLogging {
  implicit val ctx: DBAccessContext = GlobalAccessContext

  def isSuperUser(multiUserId: ObjectId): Fox[Boolean] =
    for {
      multiUser <- multiUserDAO.findOne(multiUserId)
    } yield multiUser.isSuperUser

  def multiUserIdFor(userId: ObjectId): Fox[String] =
    for {
      user <- userDAO.findOne(userId)
    } yield user._multiUser.id

  def webknossos_uri: String = wkConf.Http.uri
}

class AnalyticsSessionService @Inject()(wkConf: WkConf) extends LazyLogging {
  // Maintains session IDs per multiUser. The value is the start time of the session.
  // After an inactivity pause a new session id is assigned.

  // After this duration of inactivity, a new session ID is generated for a user
  private lazy val pause: FiniteDuration = wkConf.BackendAnalytics.sessionPause

  // format: userId → (lastRefreshTimestamp, sessionId)
  private lazy val sessionIdStore: scala.collection.mutable.Map[ObjectId, (Long, Long)] = scala.collection.mutable.Map()

  def refreshAndGetSessionId(multiUserId: ObjectId): Long = {
    val now: Long = System.currentTimeMillis()
    sessionIdStore.synchronized {
      val valueOld = sessionIdStore.getOrElse(multiUserId, (-1L, -1L))
      val idToSet = if (valueOld._1 + pause.toMillis < now) now else valueOld._2
      sessionIdStore.put(multiUserId, (now, idToSet))
      idToSet
    }
  }

}
