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
    char[] cbufOut = new char[len + 1000];

    char qchar = '"';

    char c;

    int offset = 0;

    while (offset < len) {
      c = cbuf[offset];

      //TODO
      System.out.println("writing at " + offset + " the char " + c);

      if (c == qchar) {
        cbufOut[offset] = '&';
        cbufOut[offset + 1] = 'q';
        cbufOut[offset + 2] = 'u';
        cbufOut[offset + 3] = 'o';
        cbufOut[offset + 4] = 't';
        cbufOut[offset + 5] = ';';
        offset += 6;
      } else {
        cbufOut[offset] = c;
        offset += 1;
      }
/*
      if (c == '<') {
        ent = "&lt;";
        break;
      }

      if (c == '&') {
        ent = "&amp;";
        break;
      }*/
    }


    writer.write(cbufOut, off, len);
  }

}
