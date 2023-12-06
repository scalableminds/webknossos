package backend

import org.scalatestplus.play.PlaySpec
import utils.sql.{SqlEscaping, SqlTypeImplicits}

class SqlEscapingTestSuite extends PlaySpec with SqlTypeImplicits with SqlEscaping {
  "SQL Escaping" should {
    "not change plain string" in {
      assert(escapeLiteral("hello") == "'hello'")
    }
    "escape string with 's" in {
      assert(escapeLiteral("he'l'lo") == "'he''l''lo'")
    }
    "escape string with consecutive 's" in {
      assert(escapeLiteral("he''l''lo") == "'he''''l''''lo'")
    }
    "escape string with backslash" in {
      assert(escapeLiteral("he\\llo") == "E'he\\\\llo'")
    }
  }

  "Array Literal Parsing" should {
    "parse single element" in {
      assert(parseArrayLiteral("{hello}") == List("hello"))
    }
    "parse two elements" in {
      assert(parseArrayLiteral("{hello,there}") == List("hello", "there"))
    }
    "parse two elements if one has a comma" in {
      assert(parseArrayLiteral("""{"he,llo",there}""") == List("he,llo", "there"))
    }
    "parse two elements if one has a comma and escaped quotes" in {
      assert(parseArrayLiteral("""{"h\"e,llo",there}""") == List("""h"e,llo""", "there"))
    }
    "parse single elements if it has a comma and escaped quotes" in {
      assert(parseArrayLiteral("""{"h\"e,llo"}""") == List("""h"e,llo"""))
    }
    "parse single elements if it has escaped quotes" in {
      assert(parseArrayLiteral("""{"\"hello\""}""") == List(""""hello""""))
    }
    "parse single elements if it has single quotes" in {
      assert(parseArrayLiteral("""{'hello'}""") == List("""'hello'"""))
    }
  }

}
