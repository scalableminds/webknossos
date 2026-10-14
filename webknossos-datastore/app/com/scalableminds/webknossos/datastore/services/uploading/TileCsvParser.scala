package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.Msg
import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.JsonAutoFormat

import java.nio.charset.StandardCharsets
import java.nio.file.{Path, Paths}
import scala.collection.mutable
import scala.io.Source
import scala.util.{Try, Using}

// Inclusive on both ends, so it contains last - first + 1 sections.
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

  // Reads the file lazily, so that large CSVs are not loaded into memory at once.
  def parseSectionRange(csvFile: Path): Box[SectionRange] =
    tryo(
      Using.resource(Source.fromFile(csvFile.toFile, StandardCharsets.UTF_8.name))(source =>
        parseSectionRange(source.getLines())
      )
    ).flatMap(identity)

  def parseSectionRange(lines: Iterator[String]): Box[SectionRange] = {
    val rows = lines
      .map(_.stripPrefix("\uFEFF"))
      .filter(_.trim.nonEmpty)
      .zipWithIndex
      .map { case (line, index) =>
        (splitRow(line), index + 1)
      }
      .buffered
    if (rows.headOption.exists(_._1.headOption.exists(_.equalsIgnoreCase(headerFirstCell)))) rows.next()

    val sections = mutable.HashSet[Int]()
    var error: Option[String] = None
    while (error.isEmpty && rows.hasNext) {
      val (cells, rowNumber) = rows.next()
      parseRow(cells) match {
        case Right(section) => sections += section
        case Left(message)  => error = Some(Msg.AlignmentProject.Csv.invalidRow(rowNumber, message))
      }
    }
    error match {
      case Some(message)            => Failure(message)
      case None if sections.isEmpty => Failure(Msg.AlignmentProject.Csv.noTiles)
      case None                     =>
        val (first, last) = (sections.min, sections.max)
        (first to last).find(!sections.contains(_)) match {
          case Some(missing) =>
            Failure(Msg.AlignmentProject.Csv.sectionsNotContinuous(missing, first, last))
          case None => Full(SectionRange(first, last))
        }
    }
  }

  // Returns the section number of a valid row.
  private def parseRow(cells: Seq[String]): Either[String, Int] =
    cells match {
      case Seq(section, x, y, path, _*) =>
        for {
          sectionNumber <- section.toIntOption.toRight(Msg.AlignmentProject.Csv.sectionNotInteger(section))
          _ <- x.toDoubleOption.zip(y.toDoubleOption).toRight(Msg.AlignmentProject.Csv.positionNotNumeric(x, y))
          _ <- Either.cond(path.nonEmpty, (), Msg.AlignmentProject.Csv.emptyPath)
          _ <- Either.cond(isWithinCsvDirectory(path), (), Msg.AlignmentProject.Csv.pathNotRelative(path))
        } yield sectionNumber
      case _ =>
        Left(Msg.AlignmentProject.Csv.tooFewColumns(minColumnCount, cells.length))
    }

  // Rejects absolute paths and paths escaping the CSV’s directory, since the worker resolves them on the datastore.
  private def isWithinCsvDirectory(path: String): Boolean =
    Try {
      val normalized = Paths.get(path).normalize()
      !normalized.isAbsolute && !normalized.startsWith("..")
    }.getOrElse(false)

  // E.g. tiles.csv -> tiles.v2.csv -> tiles.v3.csv. Without a current CSV, the uploaded file name is the base.
  def nextCsvFileName(currentFileName: Option[String], uploadedFileName: String, isTaken: String => Boolean): String = {
    val baseName = currentFileName
      .getOrElse(uploadedFileName.replaceAll("[^A-Za-z0-9_.-]", "_"))
      .replaceAll("(?i)\\.csv$", "")
      .replaceAll("\\.v\\d+$", "")
    val safeBaseName = if (baseName.isEmpty || baseName.startsWith(".")) "tiles" else baseName
    (Iterator(s"$safeBaseName.csv") ++ Iterator.from(2).map(version => s"$safeBaseName.v$version.csv"))
      .find(!isTaken(_))
      .getOrElse(s"$safeBaseName.csv")
  }

  private def splitRow(line: String): Seq[String] =
    line.split(",", -1).toSeq.map(_.trim.stripPrefix("\"").stripSuffix("\"").trim)
}
