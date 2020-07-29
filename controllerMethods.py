import zlib
import binascii
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
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
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

def createUserSQL(username, user_id, profile_picture, city, state, country, firstname, lastname):

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_user_table_query = "CREATE TABLE users(\
		username varchar(400) PRIMARY KEY, \
		user_id varchar(400), \
		profile_picture varchar(400), \
		city varchar(400), \
		state varchar(400), \
		country varchar(400), \
		firstname varchar(400), \
		lastname varchar(400) \
		);"
		cursor.execute(create_user_table_query)
	except sqlite3.Error as error:
		print("Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(username)), 
			sqlite3.Binary(zlib.compress(user_id)), 
			sqlite3.Binary(zlib.compress(profile_picture)), 
			sqlite3.Binary(zlib.compress(city)), 
			sqlite3.Binary(zlib.compress(state)), 
			sqlite3.Binary(zlib.compress(country)), 
			sqlite3.Binary(zlib.compress(firstname)), 
			sqlite3.Binary(zlib.compress(lastname))))
		connection.commit()
	except sqlite3.Error as error:
		# TODO: Find out why it doesn't except when inserting primary key twice
		print("Error: " + error.args[0])
		return False

	print("Inserted values for user " + username + " into the user table.")

	return True

def writeStravaCodesSQL(user_id, strava_access_token, strava_refresh_token):

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_user_table_query = "CREATE TABLE stravaCodes(\
		user_id varchar(400) PRIMARY KEY, \
		access_token varchar(400), \
		refresh_token varchar(400), \
		date_time datetime \
		);"
		cursor.execute(create_user_table_query)
	except sqlite3.Error as error:
		print("Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO stravaCodes VALUES (?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(user_id)), 
			sqlite3.Binary(zlib.compress(strava_access_token)), 
			sqlite3.Binary(zlib.compress(strava_refresh_token)),
			sqlite3.Binary(zlib.compress(time.strftime('%Y-%m-%d %H:%M:%S')))))
		connection.commit()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	print("Inserted values for user " + user_id + " into the user table.")

def writeSpotifyCodesSQL(user_id, spotify_access_token, spotify_refresh_token):
	
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_user_table_query = "CREATE TABLE spotifyCodes(\
		user_id varchar(400) PRIMARY KEY, \
		access_token varchar(400), \
		refresh_token varchar(400), \
		date_time datetime \
		);"
		cursor.execute(create_user_table_query)
	except sqlite3.Error as error:
		print("Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO spotifyCodes VALUES (?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(user_id)), 
			sqlite3.Binary(zlib.compress(spotify_access_token)), 
			sqlite3.Binary(zlib.compress(spotify_refresh_token)),
			sqlite3.Binary(zlib.compress(time.strftime('%Y-%m-%d %H:%M:%S')))))
		connection.commit()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	print("Inserted values for user " + user_id + " into the user table.")

def createUserFromSession(session):
	# user table
	username = session['strava_athlete']['username'].encode("utf-8")
	user_id = str(session['strava_athlete']['id'])
	profile_picture = session['strava_athlete']['profile'].encode("utf-8")
	city = session['strava_athlete']['city'].encode("utf-8")
	state = session['strava_athlete']['state'].encode("utf-8")
	country = session['strava_athlete']['country'].encode("utf-8")
	firstname = session['strava_athlete']['firstname'].encode("utf-8")
	lastname = session['strava_athlete']['lastname'].encode("utf-8")
	createUserSQLResult = createUserSQL(username, user_id, profile_picture, city, state, country, firstname, lastname)
	
	# strava access table
	strava_access_token = session['strava_access_token']
	strava_refresh_token = session['strava_refresh_token']
	writeStravaCodesSQLResult = writeStravaCodesSQL(user_id, strava_access_token, strava_refresh_token)

	# spotify access table
	spotify_access_token = session['spotify_access_token']
	spotify_refresh_token = session['spotify_refresh_token']
	writeSpotifyCodesSQLResult = writeSpotifyCodesSQL(user_id, spotify_access_token, spotify_refresh_token)

def databaseView():
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return "Error: " + error.args[0]

	result = cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
	tableNames = []
	for row in result:
		tableNames.append(row[0])

	htmlOutput = []

	for tableName in tableNames:
		htmlOutput.append("<h3>" + str(tableName) + "</h3>")
		htmlOutput.append("<table>")
		rows = cursor.execute("SELECT * FROM " + tableName)
		names = [description[0] for description in cursor.description]
		
		print(names)
		htmlOutput.append("<tr>")
		for name in names:
			htmlOutput.append("<th>")
			htmlOutput.append(name)
			htmlOutput.append("</th>")
		htmlOutput.append("</tr>")

		for row in rows: 
			htmlOutput.append("<tr>")
			for cell in row:
				htmlOutput.append("<td>")
				htmlOutput.append(zlib.decompress(cell))
				htmlOutput.append("</td>")
			htmlOutput.append("</tr>")
		htmlOutput.append("</table>")
	print ("".join(htmlOutput))
	return "".join(htmlOutput)