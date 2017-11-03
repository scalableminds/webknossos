import json, sys

# migrate skeleton update actions to the new format introduced in August 2017
# expected input: text file with a json object on each line containing the updates of a request
# run this with python3

def main():
	filename = sys.argv[1]
	with open(filename) as infile:
		with open("{}-migrated.txt".format(filename), 'w') as outfile:
			for line in infile:
				lineObj = json.loads(cleanLine(line))
				transformed = json.dumps(migrate(lineObj)) #, indent=4, sort_keys=True
				print(transformed, file=outfile)
	print("wrote {}".format(outfile.name))

def cleanLine(line):
	toRemove = [')', 'ObjectId(', 'NumberLong(']
	for r in toRemove:
		line = line.replace(r, '')
	return line

def migrate(updateRequest):
	group = {
		'version': updateRequest['version'],
		'timestamp': updateRequest['timestamp'],
		'actions': migrateActions(updateRequest['content'])
	}
	return [group]

def migrateActions(actions):
	return [migrateAction(a) for a in actions]

def migrateAction(action):
	transformed = {'name': action['action'], 'value': action['value']}
	if 'timestamp' in transformed['value']:
		del transformed['value']['timestamp']
	if transformed['name'] == 'deleteNode':
		transformed['value']['nodeId'] = transformed['value']['id']
		del transformed['value']['id']
	return transformed

if __name__ == '__main__':
	main()
