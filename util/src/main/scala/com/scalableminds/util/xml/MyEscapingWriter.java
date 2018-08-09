package com.scalableminds.util.xml;

import java.io.Writer;

public class MyEscapingWriter extends Writer {

  private Writer writer;

  public MyEscapingWriter(Writer w) {
    this.writer = w;
  }

  public void close() throws java.io.IOException {
    writer.close();
  }

  public void flush() throws java.io.IOException {
    writer.flush();
  }

  public void write(char[] cbuf, int off, int len) throws java.io.IOException {
    char[] cbufOut;

    char c;

    int offset = 0;
    int index = 0;

    String entity = null;

    while (offset + index < len) {

      offset = offset + index;
      index = 0;
      cbufOut = new char[len];

      while (offset + index < len) {
        c = cbuf[offset + index];
        entity = null;

        if (c == '"') {
          entity = "&quot;";
          break;
        } else if (c == '&') {
          entity = "&amp;";
          break;
        } else if (c == '>') {
          entity = "&gt;";
          break;
        } else if (c == '<') {
          entity = "&lt;";
          break;
        } else if (c == '\'') {
          entity = "&apos;";
          break;
        } else {
          cbufOut[index] = c;
          index += 1;
        }
      }

      writer.write(cbufOut, 0, index);
      if (entity != null) {
        index += 1;
        writer.write(entity.toCharArray(), 0, entity.length());
      }
    }

  }

}
