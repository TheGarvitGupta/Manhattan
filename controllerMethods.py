import sqlite3
import time
from privateParams import kDatabaseName
from globalParams import kFetchingDelay

def applicationStatistics():
	stats = {}
	stats["Users"] = 0
	stats["Strava Activities"] = 0
	stats["Spotify Activities"] = 0
	return stats

def startEngine():

	print("Starting engine...")
	
	connection = None
	
	try:
		connnection = sqlite3.connect(kDatabaseName)
		cursor = connnection.cursor()
	except Error as error:
		return "Failed starting engine. " + error

	print("Engine started.")

	while(True):
		print("Fetching users...")
		USERS_TABLE_query = "SELECT name FROM sqlite_master WHERE type='table' AND name='USERS_TABLE';"
		cursor.execute(USERS_TABLE_query)
		rows = cursor.fetchall()
		if rows:
			# for each userm fetch strava and spotify updates
			# store them in database
			# if access token error, call renewal, else die.
			print()

		else:
			print("Total users:", len(rows))

		time.sleep(kFetchingDelay)

def createUserFromStrava(result):
	print (result.text)