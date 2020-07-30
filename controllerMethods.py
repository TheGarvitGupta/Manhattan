import requests
import threading
import json
import sqlite3
import pprint
import zlib
import binascii
import sqlite3
import time

from globalParams import kSpotifyTokenURL
from globalParams import kSpotifyRedirectURI
from globalParams import kSpotifyScope
from globalParams import kSpotifyClientID

from privateParams import kDatabaseName
from globalParams import kFetchingDelay

from authorizationRequests import spotifyTokenRequestWithRefreshToken
from authorizationRequests import spotifyTokenHeaders

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

def updateSpotifyCodesSQL(user_id, spotify_access_token, spotify_access_token_validity):
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	# Insert the record to the table
	try:
		cursor.execute("UPDATE spotifyCodes SET access_token = ?, access_token_validity = ? WHERE user_id = ?", (
			sqlite3.Binary(zlib.compress(spotify_access_token)), 
			sqlite3.Binary(zlib.compress(str(spotify_access_token_validity))),
			sqlite3.Binary(zlib.compress(str(user_id)))))
		connection.commit()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	print("Updated values for user " + user_id + " into the user table.")

def writeSpotifyCodesSQL(user_id, spotify_access_token, spotify_refresh_token, spotify_access_token_validity):
	
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
		date_time datetime, \
		access_token_validity integer \
		);"
		cursor.execute(create_user_table_query)
	except sqlite3.Error as error:
		print("Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO spotifyCodes VALUES (?, ?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(user_id)), 
			sqlite3.Binary(zlib.compress(spotify_access_token)), 
			sqlite3.Binary(zlib.compress(spotify_refresh_token)),
			sqlite3.Binary(zlib.compress(time.strftime('%Y-%m-%d %H:%M:%S'))),
			sqlite3.Binary(zlib.compress(str(spotify_access_token_validity)))))
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
	spotify_access_token_validity = session['spotify_access_token_validity']
	writeSpotifyCodesSQLResult = writeSpotifyCodesSQL(user_id, spotify_access_token, spotify_refresh_token, spotify_access_token_validity)

def refreshSpotifyTokens():

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print("Error: " + error.args[0])
		return False

	# Retrieve all rows everything from spotifyCodes table
	rows = cursor.execute("SELECT * FROM spotifyCodes")
	names = [description[0] for description in cursor.description]

	for row in rows:
		
		properties = {}
		for value, column in zip(row, names):
			properties[column] = zlib.decompress(value)
		
		access_token = properties['access_token']
		refresh_token = properties['refresh_token']
		date_time = time.strptime(properties['date_time'], '%Y-%m-%d %H:%M:%S')
		user_id = properties['user_id']
		access_token_validity = properties['access_token_validity']

		# Add validity check here

		spotify_token_params = spotifyTokenRequestWithRefreshToken(refresh_token)
		spotify_token_headers_dict = spotifyTokenHeaders()
		result = requests.post(kSpotifyTokenURL, data=spotify_token_params, headers=spotify_token_headers_dict).json()

		spotify_access_token = result['access_token']
		spotify_access_token_validity = result['expires_in']
		
		updateSpotifyCodesSQLResult = updateSpotifyCodesSQL(user_id, spotify_access_token, spotify_access_token_validity)

def refreshStravaTokens():
	print("Refreshed Strava Tokens")

def refreshTokensThreadFunction():
	
	exception_tolerance = 10
	
	while(exception_tolerance > 0):
		try:
			if (refreshSpotifyTokens()):
				print("refreshTokensThreadFunction(): Refreshed Spotify tokens")
			if (refreshStravaTokens()):
				print("refreshTokensThreadFunction(): Refreshed Strava tokens")
		except Exception as exception:
			print("refreshTokensThreadFunction():", exception)
			if(exception.args[0].startswith('no such table')):
				noop()
			else:
				exception_tolerance -= 1

		time.sleep(10)

	print("refreshTokensThreadFunction(): Shutting down")

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

def noop():
    return None