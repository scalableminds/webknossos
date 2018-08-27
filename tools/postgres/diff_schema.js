var program = require('commander');
var randomstring = require("randomstring");
const execSync = require('child_process').execSync;
var path = require('path');
var fs = require('fs');
var glob = require("glob")
var tmp = require('tmp');
var dircompare = require('dir-compare');

let POSTGRES_URL = ""
let ORIGINAL_POSTGRES_URL="jdbc:postgresql://localhost/webknossos" //"${POSTGRES_URL:-jdbc:postgresql://localhost/webknossos}" //TODO
const scriptdir = __dirname
const scriptName = __filename

function dump(parameter) {
	if(parameter == "DB") { 
		POSTGRES_URL=ORIGINAL_POSTGRES_URL // this environment variable is passed to dump_schema.sh
	} else {
		const tempDbName = generateRandomName()
		const postgresDirname = path.dirname(ORIGINAL_POSTGRES_URL)
		POSTGRES_URL= postgresDirname + '/' + tempDbName;
		const dbName = execSync(scriptdir+'/db_name.sh', {env: {'POSTGRES_URL': POSTGRES_URL}}).toString().trim() // "trim" to remove the line break
		if(dbName !== tempDbName) {
			console.log("Wrong dbName")	
			preocess.exit()
		}
		console.log("Creating DB " + dbName)
		const dbHost = execSync(scriptdir+'/db_host.sh', {env: {'POSTGRES_URL': POSTGRES_URL}}).toString().trim()
		execSync(`psql -U postgres -h ${dbHost} -c "CREATE DATABASE ${dbName};"`, {env: {'PGPASSWORD': 'postgres'}})
		var fileNames = glob.sync(parameter)
		let concatenateFileNames = ""
		fileNames.forEach(function(fileName) {
  			concatenateFileNames += " -f " + fileName;
		});
		execSync(`psql -U postgres -h ${dbHost} --dbname="${dbName}" -v ON_ERROR_STOP=ON -q ${concatenateFileNames}`, {env: {'PGPASSWORD': 'postgres'}})
	}
	var tmpDir = tmp.dirSync();
	execSync(`${scriptdir}/dump_schema.sh ${tmpDir.name}`, {env: {'POSTGRES_URL': POSTGRES_URL}})
	return tmpDir.name
}

function generateRandomName(){
	random = randomstring.generate({
  				length: 8,
  				charset: 'alphanumeric',
  				capitalization: 'lowercase'
			})
	return 'wk_tmp_' + random
}

function logDifference(result){
	const diff = res.diffSet.filter(function(entry) {
		return entry.state != 'equal'
	});

	diff.forEach(function (entry) {
	    var name1 = entry.name1 ? entry.name1 : '';
	    var name2 = entry.name2 ? entry.name2 : '';
	    console.log(name1 + " " + entry.type1 + " " + entry.state + " " + name2 + " " + entry.type2);
	});
}

program
  .version('0.1.0', '-v, --version')
  .arguments('<paramerter1> <paramerter2>')
  .action(function (paramerter1, paramerter2) {
     p1 = paramerter1;
     p2 = paramerter2;
  });

if(process.argv.length != 4) { // 2 "real" parameter
	console.log("Usage: $0 <sqlFiles|DB> <sqlFiles|DB>");
  	console.log("Examples:")
  	console.log("  node ", scriptName, " tools/postgres/schema.sql \"conf/evolutions/*.sql\"")
  	console.log("  node ", scriptName, " tools/postgres/schema.sql DB")
	process.exit()
}

program.parse(process.argv)
dir1 = dump(p1);
// TODO: clean up
dir2 = dump(p2);
// TODO: clean up

// strip trailing commas and sort schema files:

// diff
var res = dircompare.compareSync(dir1, dir2, {compareSize: true});
if (res.differences == 0) {
	console.log("[SUCCESS] Same schema")
} else {
	console.log("[Failure] " + res.differences + " differences:")
	logDifference(res)
}
