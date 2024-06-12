package backend

import org.scalatestplus.play.PlaySpec
import utils.sql.{SqlEscaping, SqlTypeImplicits}

class SqlEscapingTestSuite extends PlaySpec with SqlTypeImplicits with SqlEscaping {
  "SQL Escaping" should {
    "not change plain string" in {
      assert(escapeLiteral("hello") == "'hello'")
    }
    "escape string with single quotes (')" in {
      assert(escapeLiteral("he'l'lo") == "'he''l''lo'")
    }
    "escape string with consecutive single quotes (')" in {
      assert(escapeLiteral("he''l''lo") == "'he''''l''''lo'")
    }
    "escape string with backslash" in {
      assert(escapeLiteral("he\\llo") == "E'he\\\\llo'")
    }
  }

  "Array Literal Parsing" should {
    "handle null" in {
      assert(parseArrayLiteral(null) == List())
    }
    "handle emptystring" in {
      assert(parseArrayLiteral("") == List())
    }
    "handle empty array literal" in {
      assert(parseArrayLiteral("{}") == List())
    }
    "parse single element" in {
      assert(parseArrayLiteral("{hello}") == List("hello"))
    }
    "parse two elements" in {
      assert(parseArrayLiteral("{hello,there}") == List("hello", "there"))
    }
    "parse two numerical elements" in {
      assert(parseArrayLiteral("{1,2.5,5}") == List("1", "2.5", "5"))
    }
    "parse two elements if one has a comma" in {
      assert(parseArrayLiteral("""{"he,llo",there}""") == List("he,llo", "there"))
    }
    "parse two elements if one has a comma and escaped double quotes" in {
      assert(parseArrayLiteral("""{"h\"e,llo",there}""") == List("""h"e,llo""", "there"))
    }
    "parse single element if the comma is between escaped double quotes" in {
      assert(parseArrayLiteral("""{"this one has \"spe,cial\" chars"}""") == List("""this one has "spe,cial" chars"""))
    }
    "parse single elements if it has a comma and single escaped double quote" in {
      assert(parseArrayLiteral("""{"h\"e,llo"}""") == List("""h"e,llo"""))
    }
    "parse single elements if it has escaped double quotes" in {
      assert(parseArrayLiteral("""{"\"hello\""}""") == List(""""hello""""))
    }
    "parse single element if it has single quotes (')" in {
      assert(parseArrayLiteral("""{'hello'}""") == List("""'hello'"""))
    }
    "parse single element with multiple double quotes, backslashes, and commas" in {
      assert(
        parseArrayLiteral("""{"can I \\\\\\\\\"\\\",\\\\\"break,\",\",\"\",,\"it"}""") == List(
          """can I \\\\"\",\\"break,",","",,"it"""))
    }
  }

}
