package utils.sql

import scala.annotation.tailrec

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

  protected def parseArrayLiteral(literal: String): List[String] =
    if (literal == null) List.empty
    else {
      val trimmed = literal.drop(1).dropRight(1)
      if (trimmed.isEmpty)
        List.empty
      else {
        // Removing the escaped quotes to split at commas not surrounded by quotes
        // Splitting *the original string* at split positions obtained from matching there
        val withoutEscapedQuotes = trimmed.replace("\\\"", "__")
        val regex = if (withoutEscapedQuotes.contains("\"")) {
          ",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)".r
        } else {
          // If there are no quotes in the literal, no need for the complex regex, just split at all commas,
          // this is much faster.
          ",".r
        }
        val splitPositions = regex.findAllMatchIn(withoutEscapedQuotes).map(_.start).toList.sorted
        val split = splitAtPositions(splitPositions, trimmed)
        split.map(unescapeInArrayLiteral)
      }
    }

  // Split a string at specified positions. Drop 1 character at every split
  private def splitAtPositions(positions: List[Int], aString: String): List[String] = {
    @tailrec
    def splitIter(positions: List[Int], aString: String, acc: List[String]): List[String] =
      positions match {
        case pos :: remainingPositions =>
          val (first, rest) = aString.splitAt(pos)
          splitIter(remainingPositions.map(_ - pos - 1), rest.substring(1), first :: acc)
        case Nil => acc.reverse :+ aString
      }
    splitIter(positions, aString, List.empty)
  }

  private def unescapeInArrayLiteral(aString: String): String = {
    val withUnescapedQuotes =
      aString.replace("\\\"", """"""").replace("\\,", ",").replace("\\\\", "\\")
    if (withUnescapedQuotes.startsWith("\"") && withUnescapedQuotes.endsWith("\"")) {
      withUnescapedQuotes.drop(1).dropRight(1)
    } else withUnescapedQuotes
  }

}
