package utils

import com.scalableminds.util.time.Instant
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import slick.jdbc.PositionedParameters

import java.sql.Types
import scala.collection.mutable
import scala.collection.mutable.ListBuffer

class CustomSQLInterpolation(val s: StringContext) extends AnyVal {
  def nsql(param: Any*): SQLToken = {
    val parts = s.parts.toList
    val values = param.toList

    val outputSql = mutable.StringBuilder.newBuilder
    val outputValues = ListBuffer[SQLLiteral]()

    assert(parts.length == values.length + 1)
    for (i <- parts.indices) {
      outputSql ++= parts(i);

      if (i < values.length) {
        val value = values(i)
        value match {
          case x: SQLToken => {
            outputSql ++= x.sql
            outputValues ++= x.values
          }
          case x => {
            val literal = SQLLiteral.makeLiteral(x)
            outputSql ++= literal.getPlaceholder()
            outputValues += literal
          }
        }
      }
    }

    SQLToken(sql = outputSql.toString, values = outputValues.toList)
  }
}

object CustomSQLInterpolation2 {
  implicit def customSQLInterpolation(s: StringContext): CustomSQLInterpolation = new CustomSQLInterpolation(s)
}

case class SQLToken(sql: String, values: List[SQLLiteral] = List()) {
  def debug(): String = {
    val parts = sql.split("\\?", -1)
    assert(parts.tail.length == values.length)
    parts.tail.zip(values).foldLeft(parts.head)((acc, x) => acc + x._2.debug() + x._1)
  }
}

object SQLToken {
  def join(values: List[Either[SQLLiteral, SQLToken]], sep: String): SQLToken = {
    val outputSql = mutable.StringBuilder.newBuilder
    val outputValues = ListBuffer[SQLLiteral]()
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
    SQLToken(sql = outputSql.toString, values = outputValues.toList)
  }

  def tuple(values: List[Any]): SQLToken = {
    val literals = values.map(SQLLiteral.makeLiteral)
    SQLToken(sql = s"(${literals.map(_.getPlaceholder()).mkString(", ")})", values = literals)
  }

  def tupleList(values: List[List[Any]]): SQLToken = {
    val literalLists = values.map(list => list.map(SQLLiteral.makeLiteral))
    SQLToken(sql = literalLists.map(list => s"(${list.map(_.getPlaceholder()).mkString(", ")})").mkString(", "),
             values = literalLists.flatten)
  }

  def raw(s: String) = SQLToken(s)

  def empty() = raw("")

  def identifier(id: String) = raw('"' + id + '"')
}

trait SQLLiteral {
  def setParameter(pp: PositionedParameters): Unit

  def getPlaceholder(): String = "?"

  def debug(): String
}

object SQLLiteral {

  def makeLiteral(p: Any): SQLLiteral =
    p match {
      case x: SQLLiteral => x
      case x: String     => StringLiteral(x)
      case x: Option[_] =>
        x match {
          case Some(y) => makeLiteral(y)
          case None    => NoneLiteral()
        }
      case x: Short    => ShortLiteral(x)
      case x: Int      => IntLiteral(x)
      case x: Long     => LongLiteral(x)
      case x: Float    => FloatLiteral(x)
      case x: Double   => DoubleLiteral(x)
      case x: Boolean  => BooleanLiteral(x)
      case x: Instant  => InstantLiteral(x)
      case x: ObjectId => ObjectIdLiteral(x)
      case x: JsObject => JsonLiteral(x)
      case x: JsArray  => JsonLiteral(x)
      case x: JsValue  => JsonLiteral(x)
    }
}

case class StringLiteral(v: String) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(v)

  override def debug(): String = "'" + v + "'"
}

case class ShortLiteral(v: Short) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setShort(v)

  override def debug(): String = s"$v"
}

case class IntLiteral(v: Int) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setInt(v)

  override def debug(): String = s"$v"
}

case class LongLiteral(v: Long) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setLong(v)

  override def debug(): String = s"$v"
}

case class FloatLiteral(v: Float) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setFloat(v)

  override def debug(): String = s"$v"
}

case class DoubleLiteral(v: Double) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setDouble(v)

  override def debug(): String = s"$v"
}

case class BooleanLiteral(v: Boolean) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setBoolean(v)

  override def debug(): String = s"$v"
}

case class InstantLiteral(v: Instant) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setTimestamp(v.toSql)

  override def getPlaceholder(): String = "?::TIMESTAMPTZ"

  override def debug(): String = s"'${v.toString}'"
}

case class ObjectIdLiteral(v: ObjectId) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(v.id)

  override def debug(): String = s"'${v.id}'"
}

case class JsonLiteral(v: JsValue) extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setString(Json.stringify(v))

  override def getPlaceholder(): String = "?::JSONB"

  override def debug(): String = s"'${Json.stringify(v)}'"
}

case class NoneLiteral() extends SQLLiteral {
  override def setParameter(pp: PositionedParameters): Unit = pp.setNull(Types.BOOLEAN)
  override def debug(): String = "NULL"
}
