package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.tools.JsonAutoFormat

import java.nio.file.Paths
import scala.collection.mutable
import scala.util.Try

case class SectionRange(first: Int, last: Int) derives JsonAutoFormat

/*
 * Validates the tile CSV of an alignment project and extracts its section range.
 * Each row is section,x,y,path, with the path relative to the CSV, e.g. 5,0,240,./005_000_001_000_n_00.tif
 * Additional columns after the path are ignored.
 * An optional header row (starting with "section") is skipped.
 * Section numbers must be continuous (every number between the first and last section must occur),
 * but may start at any value. Whether the referenced files exist is not checked.
 */
object TileCsvParser {

  private val minColumnCount = 4
  private val headerFirstCell = "section"

  def parseSectionRange(lines: Iterator[String]): Box[SectionRange] = {
    val rows = lines.map(_.stripPrefix("\uFEFF")).filter(_.trim.nonEmpty).zipWithIndex.map { case (line, index) =>
      (splitRow(line), index + 1)
    }.buffered
    if (rows.headOption.exists(_._1.headOption.exists(_.equalsIgnoreCase(headerFirstCell)))) rows.next()

    val sections = mutable.HashSet[Int]()
    var error: Option[String] = None
    while (error.isEmpty && rows.hasNext) {
      val (cells, rowNumber) = rows.next()
      parseRow(cells) match {
        case Right(section) => sections += section
        case Left(message)  => error = Some(s"Row $rowNumber: $message")
      }
    }
    error match {
      case Some(message)            => Failure(message)
      case None if sections.isEmpty => Failure("The CSV file contains no tiles.")
      case None                     =>
        val (first, last) = (sections.min, sections.max)
        (first to last).find(!sections.contains(_)) match {
          case Some(missing) =>
            Failure(s"Section numbers are not continuous: section $missing is missing between $first and $last.")
          case None => Full(SectionRange(first, last))
        }
    }
  }

  // Returns the section number of a valid row.
  private def parseRow(cells: Seq[String]): Either[String, Int] =
    cells match {
      case Seq(section, x, y, path, _*) =>
        for {
          sectionNumber <- section.toIntOption.toRight(s"""section number "$section" is not an integer.""")
          _ <- x.toDoubleOption.zip(y.toDoubleOption).toRight(s"""position "$x,$y" is not numeric.""")
          _ <- Either.cond(path.nonEmpty, (), "the path is empty.")
          _ <- Either.cond(isWithinCsvDirectory(path), (), s"""path "$path" must be relative to the CSV file.""")
        } yield sectionNumber
      case _ =>
        Left(s"expected at least $minColumnCount columns (section,x,y,path), found ${cells.length}.")
    }

  // Rejects absolute paths and paths escaping the CSV’s directory, since the worker resolves them on the datastore.
  private def isWithinCsvDirectory(path: String): Boolean =
    Try {
      val normalized = Paths.get(path).normalize()
      !normalized.isAbsolute && !normalized.startsWith("..")
    }.getOrElse(false)

  private def splitRow(line: String): Seq[String] =
    line.split(",", -1).toSeq.map(_.trim.stripPrefix("\"").stripSuffix("\"").trim)
}
