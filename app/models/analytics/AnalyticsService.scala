package models.analytics

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.user.{MultiUserDAO, UserDAO}
import net.liftweb.common.Box.tryo
import play.api.http.Status.UNAUTHORIZED
import play.api.libs.json._
import utils.WkConf

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
  private lazy val wellKnownUris = tryo(conf.wellKnownUris.map(_.split("\\|")).map(parts => (parts(0), parts(1))).toMap)

  def track(analyticsEvent: AnalyticsEvent): Unit = {
    for {
      sessionId <- Fox.successful(analyticsSessionService.refreshAndGetSessionId(analyticsEvent.user._multiUser))
      analyticsJson <- analyticsEvent.toJson(analyticsLookUpService, sessionId)
      _ <- saveInDatabaseIfEnabled(analyticsJson)
      _ <- sendIfEnabled(analyticsJson)
    } yield ()
    () // Do not return the Future, so as to not block caller
  }

  def ingest(jsonEvents: List[AnalyticsEventJson], apiKey: String): Fox[Unit] =
    for {
      resolvedWellKnownUris <- wellKnownUris ?~> "wellKnownUris configuration is incorrect"
      _ <- bool2Fox(jsonEvents.forall(ev => {
        resolvedWellKnownUris.get(ev.userProperties.webknossosUri).forall(wellKnownApiKey => wellKnownApiKey == apiKey)
      })) ?~> "Provided API key is not correct for provided webknossosUri" ~> UNAUTHORIZED
      _ <- analyticsDAO.insertMany(jsonEvents)
    } yield ()

  private def sendIfEnabled(analyticsEventJson: AnalyticsEventJson): Fox[Unit] = {
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

  private def saveInDatabaseIfEnabled(analyticsEventJson: AnalyticsEventJson): Fox[Unit] = {
    if (conf.saveToDatabaseEnabled) {
      if (conf.verboseLoggingEnabled) {
        logger.info(s"Storing analytics event: $analyticsEventJson")
      }
      analyticsDAO.insertMany(List(analyticsEventJson))
    } else {
      if (conf.verboseLoggingEnabled) {
        logger.info(s"Not storing analytics event. Event was: $analyticsEventJson")
      }
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
  private lazy val sessionIdStore: scala.collection.mutable.Map[ObjectId, (Instant, Long)] =
    scala.collection.mutable.Map()

  def refreshAndGetSessionId(multiUserId: ObjectId): Long = {
    val now = Instant.now
    sessionIdStore.synchronized {
      val valueOld = sessionIdStore.getOrElse(multiUserId, (Instant.zero, -1L))
      val idToSet = if (valueOld._1 + pause < now) now.epochMillis else valueOld._2
      sessionIdStore.put(multiUserId, (now, idToSet))
      idToSet
    }
  }

}
