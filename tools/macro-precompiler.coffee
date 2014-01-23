fs = require("fs")
_ = require("underscore")


file = fs.readFileSync(process.argv[2], encoding : "utf-8")

# Macros are functions with the name `xyzMacro`. They
# are simple methods in lowest indentation level. Inside
# indentation is expected to be 2 spaces.


# loop until all macros are replaced
while file.match(/\s*[a-zA-Z0-9_]+Macro\([a-zA-Z0-9_\,\ ]+\)/gm)

  # find all defined macros
  macros = {}
  file.match(/[a-zA-Z0-9_]+Macro\ =\ \([a-zA-Z0-9_\,\ ]+\) ->\s*\n(\s*\n|\ \ [^\n]*\n)*/gm).forEach(
    (macro) -> 
      
      [ macroName ] = macro.match(/[a-zA-Z0-9_]+Macro/)
      
      # macro body: either empty lines or indented lines
      macroBody = macro.match(/(\s*\n|\ \ [^\n]*\n)*/gm).join("")
      
      # macro parameters: comma-separated list of identifiers
      [ a, macroParameters ] = macro.match(/[a-zA-Z0-9_]+Macro\ =\ \(([a-zA-Z0-9_\,\ ]+)\)/)
      
      macros[macroName] = 
        body : macroBody
        parameters : macroParameters.split(",").map( (a) -> a.trim() )
  )

  # find macro invokations to be replaced
  macroMatches = file.match(/\ *[a-zA-Z0-9_]+Macro\([a-zA-Z0-9_\,\ ]+\)/gm)
  macroMatches = _.unique(macroMatches)
  macroMatches.forEach(
    (macroMatch) -> 

      # what's the current indentation
      [ indentation ] = macroMatch.match(/^\ */) ? [""]

      [ macroName ] = macroMatch.match(/[a-zA-Z0-9_]+Macro/)
      macro = macros[macroName]

      # arguments passed to the macro
      args = macroMatch.match(/[^\(]*\(([^\)]*)\)/m)[1].split(",").map( (a) -> a.trim() )

      # replace arguments inside of macro
      body = macro.body.replace(/[a-zA-Z0-9_]+/gm, (identifier) ->
        if (index = macro.parameters.indexOf(identifier)) >= 0
          args[index]
        else
          identifier
      )
      # replace for indentation
      body = body.replace(/^\ \ /gm, (a) -> indentation)
      
      # global replace
      file = file.split(macroMatch).join(body)
  )

# remove macro definitions
file = file.replace(/[a-zA-Z0-9_]+Macro\ =\ \([a-zA-Z0-9_\,\ ]+\) ->\s*\n(\s*\n|\ \ [^\n]*\n)*/gm, "")

# output file
console.log(file)
