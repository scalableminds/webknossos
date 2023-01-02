package backend

import com.scalableminds.util.time.Instant
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.Json
import utils.NestedSQLInterpolation.nestedSQLInterpolation
import utils._

import scala.concurrent.duration.DurationInt

class SQLTestSuite extends PlaySpec {
  "SQL query creation" should {
    "construct an SQLToken with null value" in {
      val sql = nsql"""SELECT ${None}"""
      assert(sql == SqlToken("SELECT ?", List(NoneValue())))
      assert(sql.debug == "SELECT NULL")
    }
    "construct an SQLToken with boolean" in {
      val sql = nsql"""SELECT ${Some(true)}"""
      assert(sql == SqlToken("SELECT ?", List(BooleanValue(true))))
    }
    "construct an SQLToken with string" in {
      val sql = nsql"""SELECT * FROM test WHERE name = ${"Amy"}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE name = ?", List(StringValue("Amy"))))
    }
    "construct an SQLToken with numbers" in {
      val sql0 = nsql"""SELECT * FROM test WHERE age = ${3.shortValue}"""
      assert(sql0 == SqlToken("SELECT * FROM test WHERE age = ?", List(ShortValue(3))))
      val sql1 = nsql"""SELECT * FROM test WHERE age = ${3}"""
      assert(sql1 == SqlToken("SELECT * FROM test WHERE age = ?", List(IntValue(3))))
      val sql2 = nsql"""SELECT * FROM test WHERE age = ${3L}"""
      assert(sql2 == SqlToken("SELECT * FROM test WHERE age = ?", List(LongValue(3L))))
      val sql3 = nsql"""SELECT * FROM test WHERE age = ${3.0f}"""
      assert(sql3 == SqlToken("SELECT * FROM test WHERE age = ?", List(FloatValue(3.0f))))
      val sql4 = nsql"""SELECT * FROM test WHERE age = ${3.0}"""
      assert(sql4 == SqlToken("SELECT * FROM test WHERE age = ?", List(DoubleValue(3.0))))
    }
    "construct an SQLToken with json" in {
      val json = Json.obj("street" -> "Market St")
      val sql = nsql"""SELECT * FROM test WHERE address = ${json}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE address = ?::JSONB", List(JsonValue(json))))
      assert(sql.debug == """SELECT * FROM test WHERE address = '{"street":"Market St"}'::JSONB""")
    }
    "construct an SQLToken with object id" in {
      val id = ObjectId.generate
      val sql = nsql"""SELECT * FROM test WHERE _id = ${id}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE _id = ?", List(ObjectIdValue(id))))
    }
    "construct an SQLToken with date" in {
      val time = Instant.now
      val sql = nsql"""SELECT * FROM test WHERE created < ${time}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE created < ?::TIMESTAMPTZ", List(InstantValue(time))))
    }
    "construct an SQLToken with duration" in {
      val duration0 = 12 nanos
      val sql0 = nsql"""SELECT ${duration0}"""
      assert(sql0 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration0))))
      assert(DurationValue(duration0).debug() == "'0.012 MICROSECONDS'::INTERVAL")

      val duration1 = 12 micros
      val sql1 = nsql"""SELECT ${duration1}"""
      assert(sql1 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration1))))
      assert(DurationValue(duration1).debug() == "'12 MICROSECONDS'::INTERVAL")

      val duration2 = 12 millis
      val sql2 = nsql"""SELECT ${duration2}"""
      assert(sql2 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration2))))
      assert(DurationValue(duration2).debug() == "'12 MILLISECONDS'::INTERVAL")

      val duration3 = 12 seconds
      val sql3 = nsql"""SELECT ${duration3}"""
      assert(sql3 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration3))))
      assert(DurationValue(duration3).debug() == "'12 SECONDS'::INTERVAL")

      val duration4 = 12 minutes
      val sql4 = nsql"""SELECT ${duration4}"""
      assert(sql4 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration4))))
      assert(DurationValue(duration4).debug() == "'12 MINUTES'::INTERVAL")

      val duration5 = 12 hours
      val sql5 = nsql"""SELECT ${duration5}"""
      assert(sql5 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration5))))
      assert(DurationValue(duration5).debug() == "'12 HOURS'::INTERVAL")

      val duration6 = 12 days
      val sql6 = nsql"""SELECT ${duration6}"""
      assert(sql6 == SqlToken("SELECT ?::INTERVAL", List(DurationValue(duration6))))
      assert(DurationValue(duration6).debug() == "'12 DAYS'::INTERVAL")
    }
    "construct an SQLToken with multiple values" in {
      val sql = nsql"""SELECT * FROM test WHERE age = ${3} AND name = ${"Amy"}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE age = ? AND name = ?", List(IntValue(3), StringValue("Amy"))))
    }
    "construct an SQLToken with identifiers" in {
      val sql = nsql"""SELECT * FROM ${SqlToken.identifier("test")}"""
      assert(sql == SqlToken("SELECT * FROM \"test\""))
    }
    "construct an SQLToken with raw SQL" in {
      val sql = nsql"""SELECT * FROM test WHERE ${SqlToken.raw("TRUE")}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE TRUE"))
    }
    "construct an SQLToken with empty SQL" in {
      val sql = nsql"""SELECT * FROM test ${SqlToken.empty()}"""
      assert(sql == SqlToken("SELECT * FROM test "))
    }
    "construct an SQLToken with nested SQL" in {
      val accessQ = nsql"""isAdmin = ${true}"""
      val sql = nsql"""SELECT * FROM test WHERE $accessQ"""
      assert(sql == SqlToken("SELECT * FROM test WHERE isAdmin = ?", List(BooleanValue(true))))
    }
    "construct an SQLToken with tuple" in {
      val list = List(3, 5)
      val sql = nsql"""SELECT * FROM test WHERE age IN ${SqlToken.tuple(list)}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE age IN (?, ?)", List(IntValue(3), IntValue(5))))
    }
    "construct an SQLToken with tuple lists" in {
      val list = List(List("Bob", 5), List("Amy", 3))
      val sql = nsql"""INSERT INTO test(name, age) VALUES ${SqlToken.tupleList(list)}"""
      assert(
        sql == SqlToken("INSERT INTO test(name, age) VALUES (?, ?), (?, ?)",
                        List(StringValue("Bob"), IntValue(5), StringValue("Amy"), IntValue(3))))
    }
    "construct an SQLToken with nested-joined SQL" in {
      val fields = List("name", "age")
      val values = List("Bob", 5)
      val sql =
        nsql"""INSERT INTO test(${SqlToken.join(fields.map(x => Right(SqlToken.identifier(x))), ", ")}) VALUES ${SqlToken
          .tupleList(List(values))}"""

      assert(
        sql == SqlToken("""INSERT INTO test("name", "age") VALUES (?, ?)""", List(StringValue("Bob"), IntValue(5))))
    }
    "create debug output from SQLToken" in {
      val sql = nsql"""SELECT * FROM test WHERE age = ${3} AND name = ${"Amy"}"""
      assert(sql.debug == "SELECT * FROM test WHERE age = 3 AND name = 'Amy'")
    }
  }
}
