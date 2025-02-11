package utils.sql

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double}
import com.scalableminds.util.time.Instant
import play.api.libs.json.{JsValue, Json}
import slick.dbio.{Effect, NoStream}
import slick.jdbc._
import slick.sql.{SqlAction, SqlStreamingAction}
import slick.util.DumpInfo
import com.scalableminds.util.objectid.ObjectId

import java.sql.{PreparedStatement, Types}
import scala.collection.mutable
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration
import scala.concurrent.duration.FiniteDuration

class SqlInterpolator(val s: StringContext) extends AnyVal {
  def q(param: SqlToken*): SqlToken = {
    val parts = s.parts.toList
    val tokens = param.toList

    val outputSql = new mutable.StringBuilder()
    val outputValues = ListBuffer[SqlValue]()

    assert(parts.length == tokens.length + 1)
    for (i <- parts.indices) {
      outputSql ++= parts(i)

      if (i < tokens.length) {
        val token = tokens(i)
        outputSql ++= token.sql
        outputValues ++= token.values
      }
    }

    SqlToken(sql = outputSql.toString, values = outputValues.toList)
  }
}

object SqlInterpolation {
  implicit def sqlInterpolation(s: StringContext): SqlInterpolator = new SqlInterpolator(s)
}

case class SqlToken(sql: String, values: List[SqlValue] = List()) {
  def debugInfo: String = {
    // The debugInfo should be pastable in an SQL client
    val parts = sql.split("\\?", -1)
    assert(parts.tail.length == values.length)
    parts.tail.zip(values).foldLeft(parts.head)((acc, x) => acc + x._2.debugInfo + x._1)
  }

  def as[R](implicit resultConverter: GetResult[R]): SqlStreamingAction[Vector[R], R, Effect] =
    new StreamingInvokerAction[Vector[R], R, Effect] {
      def statements: List[String] = List(sql)

      protected def createInvoker(statements: Iterable[String]): StatementInvoker[R] = new StatementInvoker[R] {
        val getStatement: String = statements.head

        protected def setParam(st: PreparedStatement): Unit = {
          val pp = new PositionedParameters(st)
          values.foreach(_.setParameter(pp))
        }

        protected def extractValue(rs: PositionedResult): R = resultConverter(rs)
      }

      override def getDumpInfo = DumpInfo(DumpInfo.simpleNameFor(getClass), mainInfo = s"[$debugInfo]")

      protected def createBuilder: mutable.Builder[R, Vector[R]] = Vector.newBuilder[R]
    }

  def asUpdate: SqlAction[Int, NoStream, Effect] = as[Int](GetUpdateValue).head
}

object SqlToken {
  def tupleFromList(values: List[SqlValue]): SqlToken =
    SqlToken(sql = s"(${values.map(_.placeholder).mkString(", ")})", values = values)

  def tupleFromValues(values: SqlValue*): SqlToken =
    SqlToken(sql = s"(${values.map(_.placeholder).mkString(", ")})", values = values.toList)

  def raw(s: String): SqlToken = SqlToken(s)

  def joinBySeparator(tokens: Iterable[SqlToken], separator: String): SqlToken =
    SqlToken(sql = tokens.map(_.sql).mkString(separator), values = tokens.flatMap(_.values).toList)

  def joinByComma(tokens: Iterable[SqlToken]): SqlToken = joinBySeparator(tokens, ", ")

  def empty: SqlToken = raw("")

  def identifier(id: String): SqlToken = raw(id.split('.').map(i => f""""$i"""").mkString("."))
}

trait SqlValue {
  def setParameter(pp: PositionedParameters): Unit

  def placeholder: String = "?"

  def debugInfo: String

  def toSqlToken: SqlToken = SqlToken(sql = placeholder, values = List(this))

  def toSqlValue: SqlValue = this // to force implicit conversion
}

case class StringValue(v: String) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(v)

  override def debugInfo: String = escapeLiteral(v)
}

case class ShortValue(v: Short) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setShort(v)

  override def debugInfo: String = s"$v"
}

case class IntValue(v: Int) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setInt(v)

  override def debugInfo: String = s"$v"
}

case class LongValue(v: Long) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setLong(v)

  override def debugInfo: String = s"$v"
}

case class FloatValue(v: Float) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setFloat(v)

  override def debugInfo: String = s"$v"
}

case class DoubleValue(v: Double) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setDouble(v)

  override def debugInfo: String = s"$v"
}

case class BooleanValue(v: Boolean) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setBoolean(v)

  override def debugInfo: String = s"$v"
}

case class InstantValue(v: Instant) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setTimestamp(v.toSql)

  override def placeholder: String = "?::TIMESTAMPTZ"

  override def debugInfo: String = escapeLiteral(v.toString)
}

case class DurationValue(v: FiniteDuration) extends SqlValue with SqlEscaping {

  private def stringifyDuration = v.unit match {
    case duration.NANOSECONDS  => s"${v.length.toDouble / 1000.0} MICROSECONDS"
    case duration.MICROSECONDS => s"${v.length} MICROSECONDS"
    case duration.MILLISECONDS => s"${v.length} MILLISECONDS"
    case duration.SECONDS      => s"${v.length} SECONDS"
    case duration.MINUTES      => s"${v.length} MINUTES"
    case duration.HOURS        => s"${v.length} HOURS"
    case duration.DAYS         => s"${v.length} DAYS"
  }

  override def setParameter(pp: PositionedParameters): Unit =
    pp.setString(stringifyDuration)

  override def placeholder: String = "?::INTERVAL"

  override def debugInfo: String = escapeLiteral(stringifyDuration)
}

case class ObjectIdValue(v: ObjectId) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(v.id)

  override def debugInfo: String = escapeLiteral(v.id)
}

case class JsonValue(v: JsValue) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(Json.stringify(v))

  override def placeholder: String = "?::JSONB"

  override def debugInfo: String = escapeLiteral(Json.stringify(v))
}

case class EnumerationValue(v: Enumeration#Value) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setObject(v, Types.OTHER)

  override def placeholder: String = "?"

  override def debugInfo: String = escapeLiteral(v.toString)
}

case class StringArrayValue(v: List[String]) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setObject(v.toArray, Types.ARRAY)

  override def debugInfo: String = "{" + v.map(escapeLiteral).mkString(",") + "}"
}

case class ByteArrayValue(v: Array[Byte]) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setBytes(v)

  override def debugInfo: String = s"<${v.length}-byte raw array>"
}

case class EnumerationArrayValue(v: List[Enumeration#Value], sqlEnumName: String) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setObject(v.map(_.toString).toArray, Types.ARRAY)

  override def placeholder: String = s"?::$sqlEnumName[]"

  override def debugInfo: String = "{" + v.mkString(",") + "}"
}

case class Vector3Value(v: Vec3Double) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setObject(v, Types.OTHER)

  override def debugInfo: String = v.toString
}

case class BoundingBoxValue(v: BoundingBox) extends SqlValue with SqlEscaping {
  case class BoundingBoxSql(x: Double, y: Double, z: Double, width: Double, height: Double, depth: Double) {
    override def toString: String = s"($x,$y,$z,$width,$height,$depth)"
  }

  private val bboxSql = BoundingBoxSql(
    v.topLeft.x.toDouble,
    v.topLeft.y.toDouble,
    v.topLeft.z.toDouble,
    v.width.toDouble,
    v.height.toDouble,
    v.depth.toDouble
  )

  override def setParameter(pp: PositionedParameters): Unit =
    pp.setObject(bboxSql, Types.OTHER)

  override def debugInfo: String =
    s"'$bboxSql'"
}

case class NoneValue() extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setNull(Types.OTHER)

  override def debugInfo: String = "NULL"
}

private object GetUpdateValue extends GetResult[Int] {
  def apply(pr: PositionedResult): Int =
    throw new Exception("Update statements should not return a ResultSet")
}
