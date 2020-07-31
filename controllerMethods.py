import requests
import threading
import json
import sqlite3
import pprint
import zlib
import binascii
import sqlite3
import time
from datetime import datetime, timedelta

from globalParams import kSpotifyTokenURL
from globalParams import kStravaTokenURL

from privateParams import kDatabaseName
from globalParams import kFetchingDelay

from authorizationRequests import stravaTokenRequestWithRefreshToken

from authorizationRequests import spotifyTokenRequestWithRefreshToken
from authorizationRequests import spotifyTokenHeaders

def applicationStatistics():
	stats = {}
	stats["Users"] = 0
	stats["Strava Activities"] = 0
	stats["Spotify Activities"] = 0
	return stats

def startEngine():

	print(log_time_string() + "Starting engine...")
	
	connection = None
	
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except Error as error:
		return "Failed starting engine. " + error

	print(log_time_string() + "Engine started.")

	while(True):
		print(log_time_string() + "Fetching users...")
		USERS_TABLE_query = "SELECT name FROM sqlite_master WHERE type='table' AND name='USERS_TABLE';"
		cursor.execute(USERS_TABLE_query)
		rows = cursor.fetchall()
		if rows:
			# for each user fetch strava and spotify updates
			# store them in database
			# if access token error, call renewal, else die.
			noop()

		else:
			print(log_time_string() + "Total users:", len(rows))

		time.sleep(kFetchingDelay)

def createUserSQL(username, user_id, profile_picture, city, state, country, firstname, lastname):

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
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
		print(log_time_string() + "Warning: " + error.args[0])

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
		print(log_time_string() + "Error: " + error.args[0])
		return False

	print(log_time_string() + "Inserted values for user " + username + " into the user table.")

	return True

def updateStravaCodesSQL(user_id, strava_access_token, strava_refresh_token, strava_access_token_validity):
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Insert the record to the table
	try:
		cursor.execute("UPDATE stravaCodes SET access_token = ?, refresh_token = ?, last_update = ?, access_token_validity = ? WHERE user_id = ?", (
			sqlite3.Binary(zlib.compress(strava_access_token)), 
			sqlite3.Binary(zlib.compress(strava_refresh_token)), 
			sqlite3.Binary(zlib.compress(time.strftime('%Y-%m-%d %H:%M:%S'))),
			sqlite3.Binary(zlib.compress(str(strava_access_token_validity))),
			sqlite3.Binary(zlib.compress(str(user_id)))))
		connection.commit()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	print(log_time_string() + "Updated values for user " + user_id + " into the stravaCodes table.")

def writeStravaCodesSQL(user_id, strava_access_token, strava_refresh_token, strava_access_token_validity):

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_user_table_query = "CREATE TABLE stravaCodes(\
		user_id varchar(400) PRIMARY KEY, \
		access_token varchar(400), \
		refresh_token varchar(400), \
		last_update datetime, \
		access_token_validity integer \
		);"
		cursor.execute(create_user_table_query)
	except sqlite3.Error as error:
		print(log_time_string() + "Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO stravaCodes VALUES (?, ?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(user_id)), 
			sqlite3.Binary(zlib.compress(strava_access_token)), 
			sqlite3.Binary(zlib.compress(strava_refresh_token)),
			sqlite3.Binary(zlib.compress(time.strftime('%Y-%m-%d %H:%M:%S'))),
			sqlite3.Binary(zlib.compress(str(strava_access_token_validity)))))
		connection.commit()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	print(log_time_string() + "Inserted values for user " + user_id + " into the stravaCodes table.")

def updateSpotifyCodesSQL(user_id, spotify_access_token, spotify_access_token_validity):
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Insert the record to the table
	try:
		cursor.execute("UPDATE spotifyCodes SET access_token = ?, last_update = ?, access_token_validity = ? WHERE user_id = ?", (
			sqlite3.Binary(zlib.compress(spotify_access_token)),
			sqlite3.Binary(zlib.compress(time.strftime('%Y-%m-%d %H:%M:%S'))),
			sqlite3.Binary(zlib.compress(str(spotify_access_token_validity))),
			sqlite3.Binary(zlib.compress(str(user_id)))))
		connection.commit()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	print(log_time_string() + "Updated values for user " + user_id + " into the spotifyCodes table.")

def writeSpotifyCodesSQL(user_id, spotify_access_token, spotify_refresh_token, spotify_access_token_validity):
	
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_user_table_query = "CREATE TABLE spotifyCodes(\
		user_id varchar(400) PRIMARY KEY, \
		access_token varchar(400), \
		refresh_token varchar(400), \
		last_update datetime, \
		access_token_validity integer \
		);"
		cursor.execute(create_user_table_query)
	except sqlite3.Error as error:
		print(log_time_string() + "Warning: " + error.args[0])

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
		print(log_time_string() + "Error: " + error.args[0])
		return False

	print(log_time_string() + "Inserted values for user " + user_id + " into the spotifyCodes table.")

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
	strava_access_token_validity = session['strava_access_token_validity']
	writeStravaCodesSQLResult = writeStravaCodesSQL(user_id, strava_access_token, strava_refresh_token, strava_access_token_validity)

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
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Retrieve all rows from spotifyCodes table
	rows = cursor.execute("SELECT * FROM spotifyCodes")
	names = [description[0] for description in cursor.description]

	for row in rows:
		
		properties = {}
		for value, column in zip(row, names):
			properties[column] = zlib.decompress(value)
		
		access_token = properties['access_token']
		refresh_token = properties['refresh_token']
		last_update = time.strptime(properties['last_update'], '%Y-%m-%d %H:%M:%S')
		user_id = properties['user_id']
		access_token_validity = properties['access_token_validity']

		# Add validity check here
		needs_refresh = False
		current_time_seconds = time.mktime(time.localtime())
		last_token_update_time_seconds = time.mktime(last_update)
		if (current_time_seconds > last_token_update_time_seconds + int(access_token_validity)):
			needs_refresh = True

		# Refresh tokens conditionally
		if (needs_refresh):
			spotify_token_params = spotifyTokenRequestWithRefreshToken(refresh_token)
			spotify_token_headers_dict = spotifyTokenHeaders()
			result = requests.post(kSpotifyTokenURL, data=spotify_token_params, headers=spotify_token_headers_dict).json()

			spotify_access_token = result['access_token']
			spotify_access_token_validity = result['expires_in']
	
			updateSpotifyCodesSQLResult = updateSpotifyCodesSQL(user_id, spotify_access_token, spotify_access_token_validity)
		else:
			# print(log_time_string() + "Spotify tokens for user_id " + user_id + " are valid, skipping refresh.")
			noop()

	return True

def refreshStravaTokens():

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Retrieve all rows from stravaCodes table
	rows = cursor.execute("SELECT * FROM stravaCodes")
	names = [description[0] for description in cursor.description]

	for row in rows:
		
		properties = {}
		for value, column in zip(row, names):
			properties[column] = zlib.decompress(value)
		
		access_token = properties['access_token']
		refresh_token = properties['refresh_token']
		last_update = time.strptime(properties['last_update'], '%Y-%m-%d %H:%M:%S')
		user_id = properties['user_id']
		access_token_validity = properties['access_token_validity']

		# Add validity check here
		needs_refresh = False
		current_time_seconds = time.mktime(time.localtime())
		last_token_update_time_seconds = time.mktime(last_update)
		if (current_time_seconds > last_token_update_time_seconds + int(access_token_validity)):
			needs_refresh = True

		# Refresh tokens conditionally
		if (needs_refresh):

			strava_token_params = stravaTokenRequestWithRefreshToken(refresh_token)
			result = requests.post(kStravaTokenURL, data=strava_token_params).json()

			strava_access_token = result['access_token']
			strava_refresh_token = result['refresh_token']
			strava_access_token_validity = result['expires_in']
			
			updateStravaCodesSQLResult = updateStravaCodesSQL(user_id, strava_access_token, strava_refresh_token, strava_access_token_validity)
		else:
			# print(log_time_string() + "Strava tokens for user_id " + user_id + " are valid, skipping refresh.")
			noop()

	return True


def refreshTokensThreadFunction():
	
	exception_tolerance = 10
	
	while(exception_tolerance > 0):
		
		# Refresh Spotify Tokens
		try:
			refreshSpotifyTokens()
		except Exception as exception:
			print(log_time_string() + "refreshTokensThreadFunction: ", exception)
			if(exception.args[0].startswith('no such table')):
				noop()
			else:
				exception_tolerance -= 1

		# Refresh Strava Tokens
		try:
			refreshStravaTokens()
		except Exception as exception:
			print(log_time_string() + "refreshTokensThreadFunction: ", exception)
			if(exception.args[0].startswith('no such table')):
				noop()
			else:
				exception_tolerance -= 1

		time.sleep(10)

	print(log_time_string() + "refreshTokensThreadFunction: Shutting down")

def databaseView():
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
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

	return "".join(htmlOutput)

def noop():
    return None

def log_time_string():
	return time.strftime('Server    - - [%d/%b/%Y %H:%M:%S] ')