package utils.sql

trait SqlEscaping {
  protected def escapeLiteral(aString: String): String = {
    // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
    var hasBackslash = false
    val escaped = new StringBuffer("'")

    aString.foreach { c =>
      if (c == '\'') {
        escaped.append(c).append(c)
      } else if (c == '\\') {
        escaped.append(c).append(c)
        hasBackslash = true
      } else {
        escaped.append(c)
      }
    }
    escaped.append('\'')

    if (hasBackslash) {
      "E" + escaped.toString
    } else {
      escaped.toString
    }
  }

  protected def writeEscapedTuple(seq: List[String]): String =
    "(" + seq.map(escapeLiteral).mkString(", ") + ")"

  protected def sanitize(aString: String): String = aString.replaceAll("'", "")

  // escape ' by doubling it, escape " with backslash, drop commas
  protected def sanitizeInArrayTuple(aString: String): String =
    aString.replaceAll("'", """''""").replaceAll(""""""", """\\"""").replaceAll(""",""", "")

  protected def desanitizeFromArrayTuple(aString: String): String =
    aString.replaceAll("""\\"""", """"""").replaceAll("""\\,""", ",")

  protected def optionLiteral(aStringOpt: Option[String]): String = aStringOpt match {
    case Some(aString) => "'" + aString + "'"
    case None          => "null"
  }

  protected def optionLiteralSanitized(aStringOpt: Option[String]): String = optionLiteral(aStringOpt.map(sanitize))

  protected def writeArrayTuple(elements: List[String]): String = {
    val commaSeparated = elements.map(sanitizeInArrayTuple).map(e => s""""$e"""").mkString(",")
    s"{$commaSeparated}"
  }

  protected def writeStructTuple(elements: List[String]): String = {
    val commaSeparated = elements.mkString(",")
    s"($commaSeparated)"
  }

  protected def writeStructTupleWithQuotes(elements: List[String]): String = {
    val commaSeparated = elements.map(e => s"'$e'").mkString(",")
    s"($commaSeparated)"
  }

  protected def parseArrayTuple(literal: String): List[String] = {
    val trimmed = literal.drop(1).dropRight(1)
    if (trimmed.isEmpty)
      List.empty
    else {
      val split = trimmed.split(",", -1).toList.map(desanitizeFromArrayTuple)
      split.map { item =>
        if (item.startsWith("\"") && item.endsWith("\"")) {
          item.drop(1).dropRight(1)
        } else item
      }
    }
  }
}
