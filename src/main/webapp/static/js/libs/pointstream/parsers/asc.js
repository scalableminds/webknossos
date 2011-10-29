/*
  Copyright (c) 2010  Seneca College
  MIT LICENSE
*/
/**
  @class This parser parses .ASC filetypes. These files are ASCII
  files which have their data stored in one of the following formats:<br />
  <br />
  X, Y, Z<br />
  X, Y, Z, R, G, B<br />
  X, Y, Z, I, J, K<br />
  X, Y, Z, R, G, B, I, J, K<br />
  <br />
  Where XYZ refers to vertices, RGB refers to colors and IJK refers to normal
  vectors. Vertices are always present and color components range from 0 to 255.
  
  @version:   0.2
  @author:    Andor Salga asalga.wordpress.com
  
  Date:       November 16, 2010
*/
var ASCParser = (function() {

  /**
    @private
  */
  function ASCParser(config) {
    
    // Intentionally left undefined.
    var undef;
    
    var theParser;
    
    // Defined once to reduce number of empty functions.
    var __empty_func = function(){};
  
    var start = config.start || __empty_func;
    var parse = config.parse || __empty_func;
    var end = config.end || __empty_func;
    
    var VERSION = "0.2";
    var XHR_DONE = 4;
    
    // The .ASC file can contain different types of data
    var UNKNOWN = -1;
    var VERTS = 0;
    var VERTS_COLS = 1;
    var VERTS_NORMS = 2;
    var VERTS_COLS_NORMS = 3;

    var pathToFile = null;
    var fileSizeInBytes = 0;
    
    //
    var numParsedPoints = 0;
    var numTotalPoints = 0;
    var progress = 0;
    
    //
    var numValuesPerLine = -1;
    var colorsPresent = false;
    var normalsPresent = false;
    var layoutCode = UNKNOWN;
    
    // keep track if onprogress event handler was called to 
    // handle Chrome/WebKit vs. Minefield differences.
    //
    // Minefield will call onprogress zero or many times
    // Chrome/WebKit will call onprogress one or many times
    var onProgressCalled = false;
    var XHR;
    
    // 
    var startOfNextChunk;
    var lastNewLineIndex;
    
    /**
      @private
      
      ASC files can either contain
      X, Y, Z
      X, Y, Z, R, G, B
      X, Y, Z, I, J, K
      X, Y, Z, R, G, B, I, J, K
      
      @returns {Number} VERTS | VERTS_COLS | VERTS_NORMS | VERTS_COLS_NORMS
    */
    var getDataLayout = function(values){
    
      // The first thing we can do is find out how many components there are.
      // If there are 9, we know we are dealing with:
      // x y z   r g b   i j k
      
      // The first line will determine how many components we have
      var firstLine = values.substr(0, values.indexOf("\n"));

      // trim leading trailing spaces
      firstLine = firstLine.replace(/^\s+/,"");
      firstLine = firstLine.replace(/\s+$/,"");

      // There may be many spaces and tabs between components, easiest way
      // is to just use split and count how many components we have
      var numWhiteSpaceChunks = firstLine.split(/\s+/).length - 1;
      
      // Vertices, Colors, Normals:
      // 1.916 -2.421 -4.0   64 32 16   -0.3727 -0.2476 -0.8942
      if(numWhiteSpaceChunks === 8){
        return VERTS_COLS_NORMS;
      }
      
      // Just vertices:
      // 1.916 -2.421 -4.0339
      if(numWhiteSpaceChunks === 2){
        return VERTS;
      }
      
      // If there are 6 components, we could have 
      // vertices and colors or 
      // vertices and normals
      
      var str = "";
      var i;
      
      // We're going to try the first 500 characters and hopefully
      // figure out what we're dealing with by then.
      for(i = 0; i < 500 && i < values.length; i++){
        str += values[i];
      }
      
      var str_split = str.split(/\s+/);
      var data = [];
      
      // start at three since the first 3 values
      // are x,y,z.
      for(i = 3; i < str_split.length;i += 3){
        data.push(str_split[i]);
        i++;
        data.push(str_split[i]);
        i++;
        data.push(str_split[i]);
        i++;
      }

      // Pass 1
      for(i = 0; i < data.length; i+=3){
        // if there is any component less than 0,
        // it must represent a part of a normal vector
        if(data[i] < 0 || data[i+1] < 0 || data[i+2] < 0){
          return VERTS_NORMS;
        }
        
        // if there is any component greater than 1,
        // safely assume we are dealing with colors
        if(data[i] > 1 || data[i+1] > 1 || data[i+2] > 1){
          return VERTS_COLS;
        }
      }
      
      // Pass 2
      // If we reached this point, we're still not sure,
      // so we can try this:
      // if the length of the components add up to 1 consistently,
      // it's likely normal data
      for(i = 0; i < data.length; i+=3){
        var mag = data[i]*data[i] + data[i+1]*data[i+1] + data[i+2]*data[i+2];
        // allow a little slack for precision issues
        if( mag > 1.0001 || mag < 0.999){
          return VERTS_COLS;
        }
      }
      
      // if all the values we sampled were unit length, assume we have normals.
      return VERTS_NORMS;
    };
    
    /**
      @private
      
      The first time this function is called it will determine the contents
      of the .ASC file by calling getDataLayout. Before calling this, make sure
      the data set is large enough to determine this.
      
      This check can't be done in getDataLayout since that function has no knowledge
      of the size of the data set.
    */
    var parseChunk = function(chunk){
      
      // This occurs over network connections, but not locally.
      if(chunk !== ""){
        
        if(layoutCode === UNKNOWN){
          layoutCode = getDataLayout(chunk);
          
          switch(layoutCode){
            case VERTS:
                        numValuesPerLine = 3;
                        break;
            case VERTS_COLS:
                        numValuesPerLine = 6;
                        colorsPresent = true;
                        break;
            case VERTS_NORMS:
                        numValuesPerLine = 6;
                        normalsPresent = true;
                        break;
            case VERTS_COLS_NORMS:
                        numValuesPerLine = 9;
                        normalsPresent = true;
                        colorsPresent = true;
                        break;
            default: break;
          }
        }
        
        // Trim trailing spaces.
        chunk = chunk.replace(/\s+$/,"");
        
        // Trim leading spaces.
        chunk = chunk.replace(/^\s+/,"");
        
        // Split on white space.
        chunk = chunk.split(/\s+/);
        
        var numVerts = chunk.length/numValuesPerLine;
        numParsedPoints += numVerts;
        
        var verts = new Float32Array(numVerts * 3);
        var cols = colorsPresent ? new Float32Array(numVerts * 3) : null;
        var norms = normalsPresent ? new Float32Array(numVerts * 3) : null;

        // depending if there are colors, 
        // we'll need to read different indices.
        // if there aren't:
        // x  y  z  r  g  b  i  j  k
        // 0  1  2  3  4  5  6  7  8 <- normals start at index 6
        //
        // if there are:
        // x  y  z  i  j  k
        // 0  1  2  3  4  5 <- normals start at index 3
        var valueOffset = 0;
        if(colorsPresent){
          valueOffset = 3;
        }

        // xyz  rgb  ijk
        for(var i = 0, j = 0, len = chunk.length; i < len; i += numValuesPerLine, j += 3){
          verts[j]   = parseFloat(chunk[i]);
          verts[j+1] = parseFloat(chunk[i+1]);
          verts[j+2] = parseFloat(chunk[i+2]);

          // XBPS spec for parsers requires colors to be normalized.
          if(cols){
            cols[j]   = parseInt(chunk[i+3], 10)/255;
            cols[j+1] = parseInt(chunk[i+4], 10)/255;
            cols[j+2] = parseInt(chunk[i+5], 10)/255;
          }
        
          if(norms){
            norms[j]   = parseFloat(chunk[i + 3 + valueOffset]);
            norms[j+1] = parseFloat(chunk[i + 4 + valueOffset]);
            norms[j+2] = parseFloat(chunk[i + 5 + valueOffset]);
          }
        }
        
        // XB PointStream expects an object with named/value pairs
        // which contain the attribute arrays. These must match attribute
        // names found in the shader
        var attributes = {};
        if(verts){attributes["ps_Vertex"] = verts;}
        if(cols){attributes["ps_Color"] = cols;}
        if(norms){attributes["ps_Normal"] = norms;}
        
        parse(theParser, attributes);
      }
    };

    /**
      Returns the version of this parser.
      @name ASCParser#version
      @returns {String} parser version.
    */
    this.__defineGetter__("version", function(){
      return VERSION;
    });
    
    /**
      Get the number of parsed points so far.
      @name ASCParser#numParsedPoints
      @returns {Number} number of points parsed.
    */
    this.__defineGetter__("numParsedPoints", function(){
      return numParsedPoints;
    });
    
    /**
      Get the total number of points in the point cloud.
      @name ASCParser#numTotalPoints
      @returns {Number} number of points in the point cloud.
    */
    this.__defineGetter__("numTotalPoints", function(){
      return numTotalPoints;
    });
    
    /**
      Returns the progress of downloading the point cloud between zero and one or
      -1 if the progress is unknown.
      @name ASCParser#progress
      @returns {Number|-1}
    */
    this.__defineGetter__("progress", function(){
      return progress;
    });
    
    /**
      Returns the file size of the resource in bytes.
      @name ASCParser#fileSize
      @returns {Number} size of resource in bytes.
    */
    this.__defineGetter__("fileSize", function(){
      return fileSizeInBytes;
    });
    
    /**
      Stop downloading and parsing the associated point cloud.
    */
    this.stop = function(){
      if(XHR){
        XHR.abort();
      }
    };
    
    /**
      @param {String} path Path to the resource.
    */
    this.load = function(path){
      pathToFile = path;

      XHR = new XMLHttpRequest();
      
      // When we call the parse functions in the XHR callbacks,
      // we need to give it a reference to the parser
      theParser = this;

      /**
        @private
        
        Occurs exactly once when the resource begins
        to be downloaded.
      */
      XHR.onloadstart = function(evt){
        start(theParser);
      };
            
      /**
        @private
        
        Occurs exactly once, when the file is done being downloaded.
      */
      XHR.onload = function(evt){
        var ascData = XHR.responseText;
        var chunk = null;

        // If the onprogress event didn't get called--we simply got
        // the file in one go, we can parse from start to finish.
        if(onProgressCalled === false){
          chunk = ascData;
        }
        // Otherwise the onprogress event was called at least once,
        // that means we need to get the data from a specific point to the end.
        else if(ascData.length - lastNewLineIndex > 1){
          chunk = ascData.substring(lastNewLineIndex, ascData.length);
        }

        // If the last chunk doesn't have any digits (just spaces)
        // don't parse it.
        if(chunk && chunk.match(/[0-9]/)){
          parseChunk(chunk);
        }

        numTotalPoints = numParsedPoints;
        
        // Indicate parsing is done. Ranges from 0 to 1
        progress = 1;
        
        end(theParser);
      };
    
      /**
        @private
        
        On Minefield, this will occur zero or many times. If this function
        isn't called, that means we downloaded the entire point cloud in one
        go, which means onload was called exactly once.
        
        On Chrome/WebKit this will occur one or many times
      */
      XHR.onprogress = function(evt){
        var chunk;
        
        if(evt.lengthComputable){
          fileSizeInBytes = evt.total;
          progress = evt.loaded/evt.total;
        }

        onProgressCalled = true;

        // If we have something to actually parse..
        //
        // Before calling parseChunk, we need to make sure
        // we have enough data to determine the contents of the .ASC file.
        // A line in a .ASC file is ~50-70 bytes, so we can grab the first
        // 10 lines which should be enough for getDataLayout to determine
        // the contents.
        if(XHR.responseText && XHR.responseText.length > 500){
          var ascData = XHR.responseText;

          // we likely stopped getting data somewhere in the middle of 
          // a line in the ASC file
          
          // 5.813 2.352 6.500 0 0 0 2.646 3.577 2.516
          // 1.079 1.296 9.360 0 0 0 4.307 1.181 5.208
          // 3.163 2.225 6.139 0 0 0 0.6<-- stopped here for example
          
          // So find the last known newline. Everything from the last
          // request to this last newline can be placed in a buffer.
          lastNewLineIndex = ascData.lastIndexOf("\n");
          
          // if the status just changed and we finished downloading the
          // file, grab everyting until the end. If there is only a bunch
          // of whitespace, make a note of that and don't bother parsing.
          if(XHR.readyState === XHR_DONE){
            chunk = ascData.substring(startOfNextChunk, ascData.length);
            // If the last chunk doesn't have any digits (just spaces)
            // don't parse it.
            if(chunk.match(/[0-9]/)){
              parseChunk(chunk);
            }
          }
          // if we still have more data to go
          else{
            // Start of the next chunk starts after the newline.
            chunk = ascData.substring(startOfNextChunk, lastNewLineIndex + 1);
            startOfNextChunk = lastNewLineIndex + 1;
            parseChunk(chunk);
          }
        }
      };// onprogress
      
      // Prevent Minefield from reporting a syntax error on the console.
      if(XHR.overrideMimeType){
        XHR.overrideMimeType("application/json");
      }
      
      // Open an asynchronous request to the path.
      XHR.open("GET", path, true);
      XHR.send(null);
    };// load
  }// ctor
  return ASCParser;
}());
