package backend

import com.scalableminds.util.time.Instant
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.Json
import utils.ObjectId
import utils.sql.SqlInterpolation.sqlInterpolation
import utils.sql._

import scala.concurrent.duration.DurationInt

class SqlInterpolationTestSuite extends PlaySpec {
  "SQL query creation" should {
    "construct an SQLToken with null value" in {
      val sql = q"""SELECT $None"""
      assert(sql == SqlToken("SELECT ?", List(NoneValue())))
      assert(sql.debugInfo == "SELECT NULL")
    }
    "construct an SQLToken with boolean" in {
      val sql = q"""SELECT ${Some(true)}"""
      assert(sql == SqlToken("SELECT ?", List(BooleanValue(true))))
    }
    "construct an SQLToken with string" in {
      val sql = q"""SELECT * FROM test WHERE name = ${"Amy"}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE name = ?", List(StringValue("Amy"))))
    }
    "construct an SQLToken with escaped string" in {
      val sql = q"""SELECT * FROM test WHERE name = ${"'; DROP TABLE test; --"}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE name = ?", List(StringValue("'; DROP TABLE test; --"))))
      assert(sql.debugInfo == "SELECT * FROM test WHERE name = '''; DROP TABLE test; --'")
    }
    "construct an SQLToken with numbers" in {
      val sql0 = q"""SELECT * FROM test WHERE age = ${3.shortValue}"""
      assert(sql0 == SqlToken("SELECT * FROM test WHERE age = ?", List(ShortValue(3))))
      val sql1 = q"""SELECT * FROM test WHERE age = ${3}"""
      assert(sql1 == SqlToken("SELECT * FROM test WHERE age = ?", List(IntValue(3))))
      val sql2 = q"""SELECT * FROM test WHERE age = ${3L}"""
      assert(sql2 == SqlToken("SELECT * FROM test WHERE age = ?", List(LongValue(3L))))
      val sql3 = q"""SELECT * FROM test WHERE age = ${3.0f}"""
      assert(sql3 == SqlToken("SELECT * FROM test WHERE age = ?", List(FloatValue(3.0f))))
      val sql4 = q"""SELECT * FROM test WHERE age = ${3.0}"""
      assert(sql4 == SqlToken("SELECT * FROM test WHERE age = ?", List(DoubleValue(3.0))))
    }
    "construct an SQLToken with json" in {
      val json = Json.obj("street" -> "Market St")
      val sql = q"""SELECT * FROM test WHERE address = $json"""
      assert(sql == SqlToken("SELECT * FROM test WHERE address = ?::JSONB", List(JsonValue(json))))
      assert(sql.debugInfo == """SELECT * FROM test WHERE address = '{"street":"Market St"}'::JSONB""")
    }
    "construct an SQLToken with object id" in {
      val id = ObjectId.generate
      val sql = q"""SELECT * FROM test WHERE _id = $id"""
      assert(sql == SqlToken("SELECT * FROM test WHERE _id = ?", List(ObjectIdValue(id))))
    }
    "construct an SQLToken with date" in {
      val time = Instant(1671885060000L)
      val sql = q"""SELECT * FROM test WHERE created < $time"""
      assert(sql == SqlToken("SELECT * FROM test WHERE created < ?::TIMESTAMPTZ", List(InstantValue(time))))
      assert(sql.debugInfo == "SELECT * FROM test WHERE created < '2022-12-24T12:31:00Z'::TIMESTAMPTZ")
    }
    "construct an SQLToken with duration" in {
      val duration0 = 12 nanos
      val sql0 = q"""SELECT $duration0"""
      assert(sql0 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration0))))
      assert(sql0.debugInfo == "SELECT '0.012 MICROSECONDS'::INTERVAL")

      val duration1 = 12 micros
      val sql1 = q"""SELECT $duration1"""
      assert(sql1 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration1))))
      assert(sql1.debugInfo == "SELECT '12 MICROSECONDS'::INTERVAL")

      val duration2 = 12 millis
      val sql2 = q"""SELECT $duration2"""
      assert(sql2 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration2))))
      assert(sql2.debugInfo == "SELECT '12 MILLISECONDS'::INTERVAL")

      val duration3 = 12 seconds
      val sql3 = q"""SELECT $duration3"""
      assert(sql3 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration3))))
      assert(sql3.debugInfo == "SELECT '12 SECONDS'::INTERVAL")

      val duration4 = 12 minutes
      val sql4 = q"""SELECT $duration4"""
      assert(sql4 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration4))))
      assert(sql4.debugInfo == "SELECT '12 MINUTES'::INTERVAL")

      val duration5 = 12 hours
      val sql5 = q"""SELECT $duration5"""
      assert(sql5 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration5))))
      assert(sql5.debugInfo == "SELECT '12 HOURS'::INTERVAL")

      val duration6 = 12 days
      val sql6 = q"""SELECT $duration6"""
      assert(sql6 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration6))))
      assert(sql6.debugInfo == "SELECT '12 DAYS'::INTERVAL")
    }
    "construct an SQLToken with multiple values" in {
      val sql = q"""SELECT * FROM test WHERE age = ${3} AND name = ${"Amy"}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE age = ? AND name = ?", List(IntValue(3), StringValue("Amy"))))
    }
    "construct an SQLToken with identifiers" in {
      val sql = q"""SELECT * FROM ${SqlToken.identifier("test")}"""
      assert(sql == SqlToken("SELECT * FROM \"test\""))
    }
    "construct an SQLToken with raw SQL" in {
      val sql = q"""SELECT * FROM test WHERE ${SqlToken.raw("TRUE")}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE TRUE"))
    }
    "construct an SQLToken with empty SQL" in {
      val sql = q"""SELECT * FROM test ${SqlToken.empty}"""
      assert(sql == SqlToken("SELECT * FROM test "))
    }
    "construct an SQLToken with nested SQL" in {
      val accessQ = q"""isAdmin = ${true}"""
      val sql = q"""SELECT * FROM test WHERE $accessQ"""
      assert(sql == SqlToken("SELECT * FROM test WHERE isAdmin = ?", List(BooleanValue(true))))
    }
    "construct an SQLToken with tuple" in {
      val list = List(3, 5)
      val sql = q"""SELECT * FROM test WHERE age IN ${SqlToken.tuple(list)}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE age IN (?, ?)", List(IntValue(3), IntValue(5))))
    }
    "construct an SQLToken with tuple lists" in {
      val list = List(List("Bob", 5), List("Amy", 3))
      val sql = q"""INSERT INTO test(name, age) VALUES ${SqlToken.tupleList(list)}"""
      assert(
        sql == SqlToken("INSERT INTO test(name, age) VALUES (?, ?), (?, ?)",
                        List(StringValue("Bob"), IntValue(5), StringValue("Amy"), IntValue(3))))
    }
    "construct an SQLToken with nested-joined SQL" in {
      val fields = List("name", "age")
      val values = List("Bob", 5)
      val sql =
        q"""INSERT INTO test(${SqlToken.join(fields.map(x => Right(SqlToken.identifier(x))), ", ")}) VALUES ${SqlToken
          .tupleList(List(values))}"""

      assert(
        sql == SqlToken("""INSERT INTO test("name", "age") VALUES (?, ?)""", List(StringValue("Bob"), IntValue(5))))
    }
    "create debugInfo from SQLToken" in {
      val sql = q"""SELECT * FROM test WHERE age = ${3} AND name = ${"Amy"}"""
      assert(sql.debugInfo == "SELECT * FROM test WHERE age = 3 AND name = 'Amy'")
    }
  }
}
