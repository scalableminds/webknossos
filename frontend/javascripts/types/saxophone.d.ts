/**
 * Type definitions for package saxophone
 * https://github.com/matteodelabre/saxophone
 */

declare module 'saxophone' {
    import { Writable } from 'stream';
  
    /**
     * Information about a text node.
     */
    interface TextNode {
      /** The text value. */
      contents: string;
    }
  
    /**
     * Information about a CDATA node (<![CDATA[ ... ]]>).
     */
    interface CDATANode {
      /** The CDATA contents. */
      contents: string;
    }
  
    /**
     * Information about a comment node (<!-- ... -->).
     */
    interface CommentNode {
      /** The comment contents */
      contents: string;
    }
  
    /**
     * Information about a processing instruction node (<? ... ?>).
     */
    interface ProcessingInstructionNode {
      /** The instruction contents */
      contents: string;
    }
  
    /**
     * Information about an opened tag (<tag attr="value">).
     */
    interface TagOpenNode {
      /** Name of the tag that was opened. */
      name: string;
      /** 
       * Attributes passed to the tag, in a string representation
       * (use Saxophone.parseAttrs to get an attribute-value mapping).
       */
      attrs: string;
      /** 
       * Whether the tag self-closes (tags of the form `<tag />`).
       * Such tags will not be followed by a closing tag.
       */
      isSelfClosing: boolean;
    }
  
    /**
     * Information about a closed tag (</tag>).
     */
    interface TagCloseNode {
      /** The tag name */
      name: string;
    }
  
    /**
     * Parse a XML stream and emit events corresponding
     * to the different tokens encountered.
     */
    class Saxophone extends Writable {
      /**
       * Create a new parser instance.
       */
      constructor();
  
      /**
       * Register event handler for text nodes
       */
      on(event: 'text', callback: (node: TextNode) => void): this;
  
      /**
       * Register event handler for CDATA nodes
       */
      on(event: 'cdata', callback: (node: CDATANode) => void): this;
  
      /**
       * Register event handler for comment nodes
       */
      on(event: 'comment', callback: (node: CommentNode) => void): this;
  
      /**
       * Register event handler for processing instruction nodes
       */
      on(event: 'processinginstruction', callback: (node: ProcessingInstructionNode) => void): this;
  
      /**
       * Register event handler for opening tag nodes
       */
      on(event: 'tagopen', callback: (node: TagOpenNode) => void): this;
  
      /**
       * Register event handler for closing tag nodes
       */
      on(event: 'tagclose', callback: (node: TagCloseNode) => void): this;
  
      /**
       * Register event handler for parsing errors
       */
      on(event: 'error', callback: (error: Error) => void): this;
  
      /**
       * Register event handler for the end of parsing
       */
      on(event: 'finish', callback: () => void): this;
  
      /**
       * Generic event handler registration
       */
      on(event: string, callback: (...args: any[]) => void): this;
  
      /**
       * Remove event listener
       */
      removeListener(event: string, callback: (...args: any[]) => void): this;
  
      /**
       * Immediately parse a complete chunk of XML and close the stream.
       */
      parse(input: string | Buffer): this;
  
      /**
       * Write a chunk of XML to the parser
       */
      write(chunk: string | Buffer, encoding?: string, callback?: (error?: Error | null) => void): boolean;
  
      /**
       * End the stream and trigger the 'finish' event
       */
      end(chunk?: string | Buffer, encoding?: string, callback?: () => void): void;
  
      /**
       * Parse a string list of XML attributes into an object
       */
      static parseAttrs(attrs: string): Record<string, string>;
  
      /**
       * Parses a piece of XML text and expands all XML entities inside it to the characters they represent
       */
      static parseEntities(text: string): string;
    }
  
    export = Saxophone;
  } 