package com.scalableminds.codegen

import org.slf4j.LoggerFactory
import slick.basic.DatabaseConfig
import slick.codegen.SourceCodeGenerator
import slick.jdbc.JdbcProfile
import slick.{model => slickModel}

import java.io.{BufferedWriter, File, FileOutputStream, OutputStreamWriter}
import java.net.URI
import java.nio.charset.StandardCharsets
import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.Duration

/** Generates Slick classes that mirror the SQL tables of the currently active schema. Differs from parent
  * Slick.SourceCodeGenerator by not updating unchanged tables.
  */
class ContentStableSourceCodeGenerator(model: slickModel.Model) extends SourceCodeGenerator(model) {

  private val logger = LoggerFactory.getLogger(classOf[ContentStableSourceCodeGenerator])

  /** A set of absolute paths of every file this code generator intends to produce (whether or not it was actually
    * rewritten). Used afterwards to prune files of tables that no longer exist.
    */
  private val intendedFiles = scala.collection.mutable.Set[String]()

  /** Names of the files actually rewritten in this run (content differed from disk). */
  private val updatedFiles = scala.collection.mutable.Buffer[String]()

  // Mirrors slick's OutputHelpers.writeStringToFile, but skips the write when the on-disk content is
  // already identical, so unchanged table files keep their timestamp and do not trigger recompiles.
  override def writeStringToFile(content: String, folder: String, pkg: String, fileName: String): Unit = {
    val folderPath = folder + "/" + pkg.replace(".", "/") + "/"
    new File(folderPath).mkdirs()
    val file = new File(folderPath + fileName)
    intendedFiles += file.getCanonicalPath

    val normalized = if (content.endsWith("\n")) content else content + "\n"
    val existing =
      if (file.exists()) {
        val src = scala.io.Source.fromFile(file, "UTF-8")
        try Some(src.mkString)
        finally src.close()
      } else None

    if (!existing.contains(normalized)) {
      updatedFiles += fileName
      file.setWritable(true)
      val writer = new BufferedWriter(
        new OutputStreamWriter(new FileOutputStream(file.getAbsoluteFile), StandardCharsets.UTF_8)
      )
      try writer.write(normalized)
      finally writer.close()
    }
  }

  /** Generate the multi-file model, delete generated files for tables that no longer exist. */
  def writeToMultipleFilesAndPrune(profile: String, folder: String, pkg: String, container: String): Unit = {
    writeToMultipleFiles(profile, folder, pkg, container)
    val folderPath = folder + "/" + pkg.replace(".", "/") + "/"
    val pruned = Option(new File(folderPath).listFiles()).getOrElse(Array.empty[File]).count { file =>
      val isStale = file.getName.endsWith(".scala") && !intendedFiles.contains(file.getCanonicalPath)
      if (isStale) file.delete() else false
    }

    val unchanged = intendedFiles.size - updatedFiles.size
    if (updatedFiles.isEmpty && pruned == 0) {
      logger.info(s"Slick codegen: all ${intendedFiles.size} generated files already up to date.")
    } else {
      logger.info(
        s"Slick codegen: updated ${updatedFiles.size} of ${intendedFiles.size} generated files " +
          s"($unchanged unchanged, $pruned pruned): ${updatedFiles.sorted.mkString(", ")}"
      )
    }
  }
}

/** Entry point invoked from the sbt slick code generation task (see project/AssetCompilation.scala).
  *
  * args(0): slick config URI, e.g. file:///.../conf/slick.conf#slick args(1): output base directory for the generated
  * sources
  *
  * This replicates slick.codegen.SourceCodeGenerator.run for the config-URI case, but uses
  * ContentStableSourceCodeGenerator and multi-file output.
  */
object SchemaCodeGenerator {
  def main(args: Array[String]): Unit = {
    val configUri = new URI(args(0))
    val outputDir = args(1)

    val dc = DatabaseConfig.forURI[JdbcProfile](configUri)
    val pkg = dc.config.getString("codegen.package")
    val profileName = if (dc.profileIsObject) dc.profileName else "new " + dc.profileName

    try {
      val rawModel = Await.result(
        dc.db.run(dc.profile.createModel(None, ignoreInvalidDefaults = true).withPinnedSession),
        Duration.Inf
      )

      // Strip foreign keys from the model before generating. We never use them in scala and this reduces dependencies and thus recompilation
      val model = rawModel.copy(tables = rawModel.tables.map(_.copy(foreignKeys = Seq.empty)))

      val codegen = new ContentStableSourceCodeGenerator(model)
      codegen.writeToMultipleFilesAndPrune(profileName, outputDir, pkg, "Tables")
    } finally dc.db.close()
  }
}
