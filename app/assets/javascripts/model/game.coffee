### define
"libs/request" : request
###

Game = 	
	initialize : -> 
		
		request(
			url : "/game/initialize"
			responseType : "json"
		).pipe (data) =>
			_.extend(this, data)
			return


