package models.analytics

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SimpleSQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AnalyticsDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {
  def insertMany(events: Iterable[AnalyticsEventJson]): Fox[Unit] = {
    val values = events.map(ev => {
      SqlToken.tupleFromValues(
        ObjectId.generate,
        ev.time,
        ev.sessionId,
        ev.eventType,
        ev.eventProperties,
        ev.userId,
        ev.userProperties.organizationId,
        ev.userProperties.isOrganizationAdmin,
        ev.userProperties.isSuperUser,
        ev.userProperties.webknossosUri
      )
    })

    for {
      _ <- run(q"""
        INSERT INTO webknossos.analyticsEvents(
          _id,
          created,
          sessionId,
          eventType,
          eventProperties,
          _user,
          _organization,
          isOrganizationAdmin,
          isSuperUser,
          webknossosUri
        ) VALUES ${SqlToken.joinByComma(values)}""".asUpdate)
    } yield ()
  }
}
