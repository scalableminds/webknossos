### define
libs/request : request
###

# This holds game specific data.

Game = 
	
	dataSet : null

	initialize : -> 
		
		request(
			url : "/game/initialize"
			responseType : "json"
		).pipe (data) =>
			_.extend(this, data)
			return


