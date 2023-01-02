package backend

import com.scalableminds.util.time.Instant
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.Json
import utils.CustomSQLInterpolation2.customSQLInterpolation
import utils._

class SQLTestSuite extends PlaySpec {
  "SQL query creation" should {
    "construct an SQLToken with boolean" in {
      val sql = nsql"""SELECT ${None}"""
      assert(sql == SqlToken("SELECT ?", List(NoneLiteral())))
      assert(sql.debug() == "SELECT NULL")
    }
    "construct an SQLToken with optional boolean" in {
      val sql = nsql"""SELECT ${Some(true)}"""
      assert(sql == SqlToken("SELECT ?", List(BooleanLiteral(true))))
    }
    "construct an SQLToken with string" in {
      val sql = nsql"""SELECT * FROM test WHERE name = ${"Emilia"}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE name = ?", List(StringLiteral("Emilia"))))
    }
    "construct an SQLToken with numbers" in {
      val sql0 = nsql"""SELECT * FROM test WHERE age = ${3.shortValue}"""
      assert(sql0 == SqlToken("SELECT * FROM test WHERE age = ?", List(ShortLiteral(3))))
      val sql1 = nsql"""SELECT * FROM test WHERE age = ${3}"""
      assert(sql1 == SqlToken("SELECT * FROM test WHERE age = ?", List(IntLiteral(3))))
      val sql2 = nsql"""SELECT * FROM test WHERE age = ${3L}"""
      assert(sql2 == SqlToken("SELECT * FROM test WHERE age = ?", List(LongLiteral(3L))))
      val sql3 = nsql"""SELECT * FROM test WHERE age = ${3.0f}"""
      assert(sql3 == SqlToken("SELECT * FROM test WHERE age = ?", List(FloatLiteral(3.0f))))
      val sql4 = nsql"""SELECT * FROM test WHERE age = ${3.0}"""
      assert(sql4 == SqlToken("SELECT * FROM test WHERE age = ?", List(DoubleLiteral(3.0))))
    }
    "construct an SQLToken with json" in {
      val json = Json.obj("street" -> "Market St")
      val sql = nsql"""SELECT * FROM test WHERE address = ${json}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE address = ?::JSONB", List(JsonLiteral(json))))
      assert(sql.debug() == """SELECT * FROM test WHERE address = '{"street":"Market St"}'::JSONB""")
    }
    "construct an SQLToken with object id" in {
      val id = ObjectId.generate
      val sql = nsql"""SELECT * FROM test WHERE _id = ${id}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE _id = ?", List(ObjectIdLiteral(id))))
    }
    "construct an SQLToken with date" in {
      val time = Instant.now
      val sql = nsql"""SELECT * FROM test WHERE created < ${time}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE created < ?::TIMESTAMPTZ", List(InstantLiteral(time))))
    }
    "construct an SQLToken with multiple values" in {
      val sql = nsql"""SELECT * FROM test WHERE age = ${3} AND name = ${"Emilia"}"""
      assert(
        sql == SqlToken("SELECT * FROM test WHERE age = ? AND name = ?", List(IntLiteral(3), StringLiteral("Emilia"))))
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
      assert(sql == SqlToken("SELECT * FROM test WHERE isAdmin = ?", List(BooleanLiteral(true))))
    }
    "construct an SQLToken with tuple" in {
      val list = List(3, 5)
      val sql = nsql"""SELECT * FROM test WHERE age IN ${SqlToken.tuple(list)}"""
      assert(sql == SqlToken("SELECT * FROM test WHERE age IN (?, ?)", List(IntLiteral(3), IntLiteral(5))))
    }
    "construct an SQLToken with tuple lists" in {
      val list = List(List("Bela", 5), List("Emilia", 3))
      val sql = nsql"""INSERT INTO test(name, age) VALUES ${SqlToken.tupleList(list)}"""
      assert(
        sql == SqlToken("INSERT INTO test(name, age) VALUES (?, ?), (?, ?)",
                        List(StringLiteral("Bela"), IntLiteral(5), StringLiteral("Emilia"), IntLiteral(3))))
    }
    "construct an SQLToken with nested-joined SQL" in {
      val fields = List("name", "age")
      val values = List("Bela", 5)
      val sql =
        nsql"""INSERT INTO test(${SqlToken.join(fields.map(x => Right(SqlToken.identifier(x))), ", ")}) VALUES ${SqlToken
          .tupleList(List(values))}"""

      assert(
        sql == SqlToken("""INSERT INTO test("name", "age") VALUES (?, ?)""",
                        List(StringLiteral("Bela"), IntLiteral(5))))
    }
    "create debug output from SQLToken" in {
      val sql = nsql"""SELECT * FROM test WHERE age = ${3} AND name = ${"Emilia"}"""
      assert(sql.debug() == "SELECT * FROM test WHERE age = 3 AND name = 'Emilia'")
    }

  }
}
