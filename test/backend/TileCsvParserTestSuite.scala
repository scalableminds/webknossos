package backend

import com.scalableminds.util.box.{Failure, Full}
import com.scalableminds.webknossos.datastore.services.uploading.{SectionRange, TileCsvParser}
import org.scalatest.wordspec.AnyWordSpec

class TileCsvParserTestSuite extends AnyWordSpec {

  private def parse(csv: String) = TileCsvParser.parseSectionRange(csv.linesIterator)

  private def failureMessage(csv: String): String = parse(csv) match {
    case f: Failure => f.msg
    case other      => fail(s"Expected a failure, got $other")
  }

  "TileCsvParser" should {
    "extract the section range from continuous sections with an arbitrary start" in {
      val csv =
        """5,0,240,./005_000_001_000_n_00.tif
          |5,1024,240,./005_000_002_000_n_00.tif
          |6,0,240,./006_000_001_000_n_00.tif
          |7,0.5,240.25,tiles/007_000_001_000_n_00.tif
          |""".stripMargin
      assert(parse(csv) == Full(SectionRange(5, 7)))
    }

    "skip an optional header row, a BOM, blank lines and quotes" in {
      val csv = "\uFEFFsection,x,y,path\n\n\"3\",0,0,\"./a.tif\"\n4,0,0,./b.tif\n\n"
      assert(parse(csv) == Full(SectionRange(3, 4)))
    }

    "reject gaps in the section numbers" in
      assert(failureMessage("57,0,0,./a.tif\n59,0,0,./b.tif\n").contains("section 58 is missing"))

    "ignore additional columns after the path" in
      assert(parse("1,0,0,./a.tif,extra,0.5\n2,0,0,./b.tif\n") == Full(SectionRange(1, 2)))

    "reject rows with too few columns, with the row number" in
      assert(failureMessage("1,0,0,./a.tif\n2,0,./b.tif\n").contains("Row 2: expected at least 4 columns"))

    "reject non-integer sections and non-numeric positions" in {
      assert(failureMessage("two,0,0,./a.tif\n").contains("not an integer"))
      assert(failureMessage("1,left,0,./a.tif\n").contains("not numeric"))
    }

    "reject empty paths and paths outside of the CSV directory" in {
      assert(failureMessage("1,0,0,\n").contains("path is empty"))
      assert(failureMessage("1,0,0,/etc/passwd\n").contains("relative to the CSV"))
      assert(failureMessage("1,0,0,./tiles/../../other/a.tif\n").contains("relative to the CSV"))
    }

    "reject empty files" in {
      assert(failureMessage("").contains("no tiles"))
      assert(failureMessage("section,x,y,path\n").contains("no tiles"))
    }
  }
}
