### define 
model/game : Game
model/binary : Binary
model/shader : Shader
model/route : Route
model/mesh : Mesh
model/trianglesplane : Trianglesplane
###

# This is the model. It takes care of the data including the 
# communication with the server.

# All public operations are **asynchronous**. We return a promise
# which you can react on.

Model = { Game, Binary, Shader, Route, Mesh, Trianglesplane }