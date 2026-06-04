package com.scalableminds.codegen

import slick.basic.DatabaseConfig
import slick.codegen.SourceCodeGenerator
import slick.jdbc.JdbcProfile
import slick.{model => slickModel}

import java.io.{BufferedWriter, File, FileWriter}
import java.net.URI
import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.Duration

/**
  * Slick code generator that emits one file per table (plus a `Tables.scala` container and a
  * `TablesRoot.scala` root trait) instead of a single monolithic `Tables.scala`, and only rewrites
  * a file when its content actually changed.
  *
  * Together these keep incremental Scala recompiles scoped to the tables that changed: when a single
  * table is altered, only that table's file changes on disk, so Zinc recompiles just that file and its
  * dependents instead of the whole generated model and everything importing it.
  *
  * The generated API is source-compatible with the previous monolith: `object Tables` still mixes in
  * every per-table trait, so `import com.scalableminds.webknossos.schema.Tables._` keeps resolving all
  * Row classes, TableQuery vals and GetResult implicits.
  */
class ContentStableSourceCodeGenerator(model: slickModel.Model) extends SourceCodeGenerator(model) {

  /** Absolute paths of every file this run intends to produce (whether or not it was actually
    * rewritten). Used afterwards to prune files of tables that no longer exist. */
  private val intendedFiles = scala.collection.mutable.Set[String]()

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
      file.setWritable(true)
      val writer = new BufferedWriter(new FileWriter(file.getAbsoluteFile))
      try writer.write(normalized)
      finally writer.close()
    }
  }

  /** Generate the multi-file model and delete generated files for tables that no longer exist. */
  def writeToMultipleFilesAndPrune(profile: String, folder: String, pkg: String, container: String): Unit = {
    writeToMultipleFiles(profile, folder, pkg, container)
    val folderPath = folder + "/" + pkg.replace(".", "/") + "/"
    Option(new File(folderPath).listFiles()).getOrElse(Array.empty[File]).foreach { file =>
      if (file.getName.endsWith(".scala") && !intendedFiles.contains(file.getCanonicalPath)) {
        file.delete()
        ()
      }
    }
  }
}

/**
  * Entry point invoked from the sbt slick code generation task (see project/AssetCompilation.scala).
  *
  * args(0): slick config URI, e.g. file:///.../conf/slick.conf#slick
  * args(1): output base directory for the generated sources
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
      val model = Await.result(
        dc.db.run(dc.profile.createModel(None, ignoreInvalidDefaults = true).withPinnedSession),
        Duration.Inf
      )
      val codegen = new ContentStableSourceCodeGenerator(model)
      codegen.writeToMultipleFilesAndPrune(profileName, outputDir, pkg, "Tables")
    } finally dc.db.close()
  }
}
