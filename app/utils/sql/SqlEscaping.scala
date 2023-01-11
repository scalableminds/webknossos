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

  protected def enumArrayLiteral(elements: List[Enumeration#Value]): String = {
    val commaSeparated = elements.map(e => s""""$e"""").mkString(",")
    s"'{$commaSeparated}'"
  }

  protected def parseArrayLiteral(literal: String): List[String] = {
    val trimmed = literal.drop(1).dropRight(1)
    if (trimmed.isEmpty)
      List.empty
    else {
      val split = trimmed.split(",", -1).toList.map(unescapeInArrayLiteral)
      split.map { item =>
        if (item.startsWith("\"") && item.endsWith("\"")) {
          item.drop(1).dropRight(1)
        } else item
      }
    }
  }

  protected def unescapeInArrayLiteral(aString: String): String =
    aString.replaceAll("""\\"""", """"""").replaceAll("""\\,""", ",")

}
