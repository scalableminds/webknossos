package utils

import com.scalableminds.util.time.Instant
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import slick.dbio.Effect
import slick.jdbc._
import slick.sql.SqlStreamingAction

import java.sql.{PreparedStatement, Types}
import scala.collection.mutable
import scala.collection.mutable.ListBuffer

class CustomSQLInterpolation(val s: StringContext) extends AnyVal {
  def nsql(param: Any*): SqlToken = {
    val parts = s.parts.toList
    val values = param.toList

    val outputSql = mutable.StringBuilder.newBuilder
    val outputValues = ListBuffer[SqlValue]()

    assert(parts.length == values.length + 1)
    for (i <- parts.indices) {
      outputSql ++= parts(i);

      if (i < values.length) {
        val value = values(i)
        value match {
          case x: SqlToken => {
            outputSql ++= x.sql
            outputValues ++= x.values
          }
          case x => {
            val sqlValue = SqlValue.makeSqlValue(x)
            outputSql ++= sqlValue.getPlaceholder()
            outputValues += sqlValue
          }
        }
      }
    }

    SqlToken(sql = outputSql.toString, values = outputValues.toList)
  }
}

object CustomSQLInterpolation2 {
  implicit def customSQLInterpolation(s: StringContext): CustomSQLInterpolation = new CustomSQLInterpolation(s)
}

case class SqlToken(sql: String, values: List[SqlValue] = List()) {
  def debug(): String = {
    val parts = sql.split("\\?", -1)
    assert(parts.tail.length == values.length)
    parts.tail.zip(values).foldLeft(parts.head)((acc, x) => acc + x._2.debug() + x._1)
  }

  def as[R](implicit rconv: GetResult[R]): SqlStreamingAction[Vector[R], R, Effect] =
    new StreamingInvokerAction[Vector[R], R, Effect] {
      def statements = List(sql)

      protected[this] def createInvoker(statements: Iterable[String]) = new StatementInvoker[R] {
        val getStatement = statements.head

        protected def setParam(st: PreparedStatement) = {
          val pp = new PositionedParameters(st);
          values.foreach(_.setParameter(pp))
        }

        protected def extractValue(rs: PositionedResult): R = rconv(rs)
      }

      protected[this] def createBuilder = Vector.newBuilder[R]
    }

  def asUpdate = as[Int](GetUpdateValue).head
}

object SqlToken {
  def join(values: List[Either[SqlValue, SqlToken]], sep: String): SqlToken = {
    val outputSql = mutable.StringBuilder.newBuilder
    val outputValues = ListBuffer[SqlValue]()
    for (i <- values.indices) {
      val value = values(i);
      value match {
        case Left(x) => {
          outputSql ++= x.getPlaceholder()
          outputValues += x
        }
        case Right(x) => {
          outputSql ++= x.sql
          outputValues ++= x.values
        }
      }
      if (i < values.length - 1) {
        outputSql ++= sep;
      }
    }
    SqlToken(sql = outputSql.toString, values = outputValues.toList)
  }

  def tuple(values: List[Any]): SqlToken = {
    val sqlValues = values.map(SqlValue.makeSqlValue)
    SqlToken(sql = s"(${sqlValues.map(_.getPlaceholder()).mkString(", ")})", values = sqlValues)
  }

  def tupleList(values: List[List[Any]]): SqlToken = {
    val sqlValueLists = values.map(list => list.map(SqlValue.makeSqlValue))
    SqlToken(sql = sqlValueLists.map(list => s"(${list.map(_.getPlaceholder()).mkString(", ")})").mkString(", "),
             values = sqlValueLists.flatten)
  }

  def raw(s: String) = SqlToken(s)

  def empty() = raw("")

  def identifier(id: String) = raw('"' + id + '"')
}

trait SqlValue {
  def setParameter(pp: PositionedParameters): Unit

  def getPlaceholder(): String = "?"

  def debug(): String
}

object SqlValue {

  def makeSqlValue(p: Any): SqlValue =
    p match {
      case x: SqlValue => x
      case x: String   => StringValue(x)
      case x: Option[_] =>
        x match {
          case Some(y) => makeSqlValue(y)
          case None    => NoneValue()
        }
      case x: Short    => ShortValue(x)
      case x: Int      => IntValue(x)
      case x: Long     => LongValue(x)
      case x: Float    => FloatValue(x)
      case x: Double   => DoubleValue(x)
      case x: Boolean  => BooleanValue(x)
      case x: Instant  => InstantValue(x)
      case x: ObjectId => ObjectIdValue(x)
      case x: JsObject => JsonValue(x)
      case x: JsArray  => JsonValue(x)
      case x: JsValue  => JsonValue(x)
    }
}

case class StringValue(v: String) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(v)

  override def debug(): String = "'" + v + "'"
}

case class ShortValue(v: Short) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setShort(v)

  override def debug(): String = s"$v"
}

case class IntValue(v: Int) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setInt(v)

  override def debug(): String = s"$v"
}

case class LongValue(v: Long) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setLong(v)

  override def debug(): String = s"$v"
}

case class FloatValue(v: Float) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setFloat(v)

  override def debug(): String = s"$v"
}

case class DoubleValue(v: Double) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setDouble(v)

  override def debug(): String = s"$v"
}

case class BooleanValue(v: Boolean) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setBoolean(v)

  override def debug(): String = s"$v"
}

case class InstantValue(v: Instant) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setTimestamp(v.toSql)

  override def getPlaceholder(): String = "?::TIMESTAMPTZ"

  override def debug(): String = s"'${v.toString}'"
}

case class ObjectIdValue(v: ObjectId) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(v.id)

  override def debug(): String = s"'${v.id}'"
}

case class JsonValue(v: JsValue) extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(Json.stringify(v))

  override def getPlaceholder(): String = "?::JSONB"

  override def debug(): String = s"'${Json.stringify(v)}'"
}

case class NoneValue() extends SqlValue {
  override def setParameter(pp: PositionedParameters): Unit = pp.setNull(Types.BOOLEAN)

  override def debug(): String = "NULL"
}

private object GetUpdateValue extends GetResult[Int] {
  def apply(pr: PositionedResult) =
    throw new Exception("Update statements should not return a ResultSet")
}
