package utils.sql

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import play.api.libs.json.{JsValue, Json}
import slick.dbio.{Effect, NoStream}
import slick.jdbc._
import slick.sql.{SqlAction, SqlStreamingAction}
import slick.util.DumpInfo
import utils.ObjectId

import java.sql.{PreparedStatement, Types}
import scala.annotation.tailrec
import scala.collection.mutable
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration
import scala.concurrent.duration.FiniteDuration

class SqlInterpolator(val s: StringContext) extends AnyVal {
  def q(param: SqlToken*): SqlToken = {
    val parts = s.parts.toList
    val tokens = param.toList

    val outputSql = mutable.StringBuilder.newBuilder
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

      protected[this] def createInvoker(statements: Iterable[String]): StatementInvoker[R] = new StatementInvoker[R] {
        val getStatement: String = statements.head

        protected def setParam(st: PreparedStatement): Unit = {
          val pp = new PositionedParameters(st)
          values.foreach(_.setParameter(pp))
        }

        protected def extractValue(rs: PositionedResult): R = resultConverter(rs)
      }

      override def getDumpInfo = DumpInfo(DumpInfo.simpleNameFor(getClass), mainInfo = s"[$debugInfo]")

      protected[this] def createBuilder: mutable.Builder[R, Vector[R]] = Vector.newBuilder[R]
    }

  def asUpdate: SqlAction[Int, NoStream, Effect] = as[Int](GetUpdateValue).head
}

object SqlToken {
  def join(values: List[Either[SqlValue, SqlToken]], sep: String): SqlToken = {
    val outputSql = mutable.StringBuilder.newBuilder
    val outputValues = ListBuffer[SqlValue]()
    for (i <- values.indices) {
      val value = values(i)
      value match {
        case Left(x) =>
          outputSql ++= x.placeholder
          outputValues += x
        case Right(x) =>
          outputSql ++= x.sql
          outputValues ++= x.values
      }
      if (i < values.length - 1) {
        outputSql ++= sep
      }
    }
    SqlToken(sql = outputSql.toString, values = outputValues.toList)
  }

  def tuple(values: Seq[Any]): SqlToken = {
    val sqlValues = values.map(SqlValue.makeSqlValue)
    SqlToken(sql = s"(${sqlValues.map(_.placeholder).mkString(", ")})", values = sqlValues.toList)
  }

  def tupleList(values: Seq[Seq[Any]]): SqlToken = {
    val sqlValueLists = values.map(list => list.map(SqlValue.makeSqlValue))
    SqlToken(sql = sqlValueLists.map(list => s"(${list.map(_.placeholder).mkString(", ")})").mkString(", "),
             values = sqlValueLists.flatten.toList)
  }

  def raw(s: String): SqlToken = SqlToken(s)

  def empty: SqlToken = raw("")

  def identifier(id: String): SqlToken = raw('"' + id + '"')
}

trait SqlValue {
  def setParameter(pp: PositionedParameters): Unit

  def placeholder: String = "?"

  def debugInfo: String

  def toToken: SqlToken = SqlToken(sql = placeholder, values = List(this))
}

trait SqlTokenConversions {
  implicit def stringToSqlToken(v: String): SqlToken = StringValue(v).toToken

  implicit def booleanToSqlToken(v: Boolean): SqlToken = BooleanValue(v).toToken

  implicit def intToSqlToken(v: Int): SqlToken = IntValue(v).toToken

  implicit def longValueToSqlToken(v: Long): SqlToken = LongValue(v).toToken

  implicit def sqlValueToSqlToken(v: SqlValue): SqlToken = v.toToken

  implicit def enumToSqlToken(v: Enumeration#Value): SqlToken = EnumerationValue(v).toToken

  implicit def objectIdToSqlToken(v: ObjectId): SqlToken = ObjectIdValue(v).toToken

  implicit def instantToSqlToken(v: Instant): SqlToken = InstantValue(v).toToken

  implicit def jsValueToSqlToken(v: JsValue): SqlToken = JsonValue(v).toToken

  implicit def optionToSqlToken[T](v: Option[T])(implicit innerConversion: T => SqlToken): SqlToken =
    v match {
      case Some(inner) => innerConversion(inner)
      case None        => NoneValue()
    }

  implicit def stringIterableToSqlToken(v: Iterable[String]): SqlToken = ArrayValue(v.toList)

  implicit def boundingBoxToSqlToken(v: BoundingBox): SqlToken = BoundingBoxValue(v).toToken

  implicit def vec3IntToSqlToken(v: Vec3Int): SqlToken = Vector3Value(v.toVec3Double).toToken

  implicit def vec3DoubleToSqlToken(v: Vec3Double): SqlToken = Vector3Value(v).toToken
}

object SqlValue {

  @tailrec
  def makeSqlValue(p: Any): SqlValue =
    p match {
      case x: SqlValue          => x
      case x: String            => StringValue(x)
      case x: Short             => ShortValue(x)
      case x: Int               => IntValue(x)
      case x: Long              => LongValue(x)
      case x: Float             => FloatValue(x)
      case x: Double            => DoubleValue(x)
      case x: Boolean           => BooleanValue(x)
      case x: Instant           => InstantValue(x)
      case x: FiniteDuration    => DurationValue(x)
      case x: ObjectId          => ObjectIdValue(x)
      case x: JsValue           => JsonValue(x)
      case x: Enumeration#Value => EnumerationValue(x)
      case x: Vec3Double        => Vector3Value(x)
      case x: Vec3Int           => Vector3Value(x.toVec3Double)
      case x: BoundingBox       => BoundingBoxValue(x)
      case x: Option[_] =>
        x match {
          case Some(y) => makeSqlValue(y)
          case None    => NoneValue()
        }
    }
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

case class ArrayValue(v: List[String]) extends SqlValue with SqlEscaping {
  override def setParameter(pp: PositionedParameters): Unit = pp.setObject(v.toArray, Types.ARRAY)

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

  private val bboxSql = BoundingBoxSql(v.topLeft.x.toDouble,
                                       v.topLeft.y.toDouble,
                                       v.topLeft.z.toDouble,
                                       v.width.toDouble,
                                       v.height.toDouble,
                                       v.depth.toDouble)

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
  def apply(pr: PositionedResult) =
    throw new Exception("Update statements should not return a ResultSet")
}
