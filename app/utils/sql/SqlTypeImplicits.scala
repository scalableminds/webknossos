package utils.sql

import com.scalableminds.util.time.Instant
import slick.jdbc.{GetResult, PositionedParameters, PositionedResult, SetParameter}
import utils.ObjectId

trait SqlTypeImplicits {
  implicit protected object SetObjectId extends SetParameter[ObjectId] {
    def apply(v: ObjectId, pp: PositionedParameters): Unit = pp.setString(v.id)
  }

  implicit protected object SetObjectIdOpt extends SetParameter[Option[ObjectId]] {
    def apply(v: Option[ObjectId], pp: PositionedParameters): Unit = pp.setStringOption(v.map(_.id))
  }

  implicit protected object GetObjectId extends GetResult[ObjectId] {
    override def apply(v1: PositionedResult): ObjectId = ObjectId(v1.<<)
  }

  implicit protected object SetInstant extends SetParameter[Instant] {
    def apply(v: Instant, pp: PositionedParameters): Unit = pp.setTimestamp(v.toSql)
  }

  implicit protected object SetInstantOpt extends SetParameter[Option[Instant]] {
    def apply(v: Option[Instant], pp: PositionedParameters): Unit = pp.setTimestampOption(v.map(_.toSql))
  }

  implicit protected object GetInstant extends GetResult[Instant] {
    override def apply(v1: PositionedResult): Instant = Instant.fromSql(v1.<<)
  }

  implicit protected object GetInstantOpt extends GetResult[Option[Instant]] {
    override def apply(v1: PositionedResult): Option[Instant] = v1.nextTimestampOption().map(Instant.fromSql)
  }
}
