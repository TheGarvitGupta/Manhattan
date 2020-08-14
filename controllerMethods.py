import requests
import threading
import json
import sqlite3
import pprint
import zlib
import binascii
import sqlite3
import time
import datetime# import datetime, timedelta
from dateutil.relativedelta import relativedelta
from time import mktime


from globalParams import kSpotifyTokenURL
from globalParams import kStravaTokenURL
from globalParams import kSpotifyRecentlyPlayedURL
from globalParams import kStravaListAthleteActivitiesURL
from globalParams import kStravaGetActivityRequestURL
from globalParams import kSpotifyFetchMinimumDelay
from globalParams import kStravaFetchMinimumDelay
from globalParams import kRefreshTokensMinimumDelay
from globalParams import kStravaDetailedActivityFetchMinimumDelay
from globalParams import kFetchingDelay
from globalParams import kExceptionTolerance

from privateParams import kDatabaseName

from authorizationRequests import stravaTokenRequestWithRefreshToken
from authorizationRequests import spotifyTokenRequestWithRefreshToken
from authorizationRequests import spotifyTokenHeadersBasic
from authorizationRequests import spotifyTokenHeadersBearer
from authorizationRequests import stravaTokenHeadersBearer
from authorizationRequests import spotifyRecentlyPlayedRequest
from authorizationRequests import stravaListAthleteActivitiesRequest
from authorizationRequests import stravaGetActivityRequest

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
			spotify_token_headers_dict = spotifyTokenHeadersBasic()
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

	knownExceptions = 0
	
	while(knownExceptions < kExceptionTolerance):
		
		# Refresh Spotify Tokens
		try:
			refreshSpotifyTokens()
		except Exception as exception:
			print(log_time_string() + "refreshTokensThreadFunction: ", exception)
			if(exception.args[0].startswith('no such table')):
				noop()
			else:
				knownExceptions += 1

		# Refresh Strava Tokens
		try:
			refreshStravaTokens()
		except Exception as exception:
			print(log_time_string() + "refreshTokensThreadFunction: ", exception)
			if(exception.args[0].startswith('no such table')):
				noop()
			else:
				knownExceptions += 1

		time.sleep(kRefreshTokensMinimumDelay)

	print(log_time_string() + "refreshTokensThreadFunction: Shutting down")

def writeStravaActivitiesSQL(user_id, activity_id, activity_name, activity_start_date_local, activity_average_speed, activity_type):

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_stravaActivities_table_query = "CREATE TABLE stravaActivities(\
		user_id varchar(400), \
		activity_id varchar(400), \
		activity_name varchar(400), \
		activity_start_date_local varchar(400), \
		activity_average_speed varchar(400), \
		activity_type varchar(400), \
		PRIMARY KEY (activity_id) \
		);"
		cursor.execute(create_stravaActivities_table_query)
	except sqlite3.Error as error:
		if (error.args[0].startswith("table stravaActivities already exists")):
			noop()
		else:
			print(log_time_string() + "Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO stravaActivities VALUES (?, ?, ?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(user_id.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_id.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_name.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_start_date_local.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_average_speed.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_type.encode("utf-8")))))
		connection.commit()
		print(log_time_string() + "Inserted " + activity_name + " for user " + user_id + " into the stravaActivities table.")
	except sqlite3.Error as error:
		if (error.args[0].startswith("UNIQUE constraint failed")):
			noop()
		else:
			print(log_time_string() + "Error: " + error.args[0])
			return False

def writeStravaDetailedActivitySQL(result):

	activity_id = result['id']
	activity_start_date_local = time.strptime(result['start_date_local'], '%Y-%m-%dT%H:%M:%SZ')
	activity_start_date_local_seconds = time.mktime(activity_start_date_local)
	activity_type = result['type']
	activity_average_speed = None
	activity_distance = None

	activity_split_speeds = []
	activity_split_hearts = []
	activity_split_start_dates_local = []

	if (((activity_type) == 'Run') or ((activity_type) == 'Walk')):
		activity_average_speed = result['average_speed']
		activity_distance = result['distance']

	elapsed_time = 0
	if ('splits_metric' in result):
		activity_splits_metrics = result['splits_metric']
		for activity_splits_metric in activity_splits_metrics:
			activity_split_speeds.append(activity_splits_metric['average_speed'])
			if "average_heartrate" in activity_splits_metric:
				activity_split_hearts.append(activity_splits_metric['average_heartrate'])
			else:
				activity_split_hearts.append("0")
			activity_split_start_dates_local.append(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.localtime(activity_start_date_local_seconds + elapsed_time)))
			elapsed_time += int(activity_splits_metric['elapsed_time'])

	print(activity_id, time.strftime('%Y-%m-%dT%H:%M:%SZ', activity_start_date_local), activity_type, activity_average_speed, activity_distance)
	# print(activity_split_speeds, activity_split_hearts, activity_split_start_dates_local)

	activity_split_speeds_string = ",".join([str(x) for x in activity_split_speeds])
	activity_split_hearts_string = ",".join([str(x) for x in activity_split_hearts])
	activity_split_start_dates_local = ",".join([str(x) for x in activity_split_start_dates_local])
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_stravaDetailedActivities_table_query = "CREATE TABLE stravaDetailedActivities(\
		activity_id varchar(400), \
		activity_start_date_local varchar(400), \
		activity_type varchar(400), \
		activity_average_speed varchar(400), \
		activity_distance varchar(400), \
		activity_split_speeds varchar(1000), \
		activity_split_hearts varchar(1000), \
		activity_split_start_dates_local varchar(1000), \
		PRIMARY KEY (activity_id) \
		);"
		cursor.execute(create_stravaDetailedActivities_table_query)
	except sqlite3.Error as error:
		if (error.args[0].startswith("table stravaDetailedActivities already exists")):
			noop()
		else:
			print(log_time_string() + "Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO stravaDetailedActivities VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(str(activity_id).encode("utf-8"))), 
			sqlite3.Binary(zlib.compress((time.strftime('%Y-%m-%dT%H:%M:%SZ', activity_start_date_local)).encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_type.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(str(activity_average_speed).encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(str(activity_distance).encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_split_speeds_string.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_split_hearts_string.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(activity_split_start_dates_local.encode("utf-8")))))
		connection.commit()
		print(log_time_string() + "Inserted " + str(activity_id) + " into the stravaDetailedActivities table.")
	except sqlite3.Error as error:
		if (error.args[0].startswith("UNIQUE constraint failed")):
			noop()
		else:
			print(log_time_string() + "Error: " + error.args[0])
			return False

	return None

def writeSpotifyTracksSQL(user_id, track_id, track_name, album_name, album_artist, album_image, played_at):

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Create table (would error if already exists)
	try:
		create_spotify_table_query = "CREATE TABLE spotifyTracks(\
		user_id varchar(400), \
		track_id varchar(400), \
		track_name varchar(400), \
		album_name varchar(400), \
		album_artist varchar(400), \
		album_image varchar(400), \
		played_at varchar(400), \
		PRIMARY KEY (user_id, track_id, played_at) \
		);"
		cursor.execute(create_spotify_table_query)
	except sqlite3.Error as error:
		if (error.args[0].startswith("table spotifyTracks already exists")):
			noop()
		else:
			print(log_time_string() + "Warning: " + error.args[0])

	# Insert the record to the table
	try:
		cursor.execute("INSERT INTO spotifyTracks VALUES (?, ?, ?, ?, ?, ?, ?)", (
			sqlite3.Binary(zlib.compress(user_id.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(track_id.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(track_name.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(album_name.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(album_artist.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(album_image.encode("utf-8"))), 
			sqlite3.Binary(zlib.compress(played_at.encode("utf-8")))))
		connection.commit()
		print(log_time_string() + "Inserted " + track_name + " for user " + user_id + " into the spotifyTracks table.")
	except sqlite3.Error as error:
		if (error.args[0].startswith("UNIQUE constraint failed")):
			noop()
		else:
			print(log_time_string() + "Error: " + error.args[0])
			return False

def spotifyDownloadThreadFunction():

	knownExceptions = 0

	while(knownExceptions < kExceptionTolerance):

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
			
			user_id = properties['user_id']
			access_token = properties['access_token']

			spotify_token_params = spotifyRecentlyPlayedRequest()
			spotify_token_headers_dict = spotifyTokenHeadersBearer(access_token)

			try:
				result = requests.get(kSpotifyRecentlyPlayedURL, params=spotify_token_params, headers=spotify_token_headers_dict).json()
				if ('items' not in result):
					print(log_time_string() + "spotifyDownloadThreadFunction standing by for refreshing expired Spotify tokens")
				else:
					for item in result['items']:
						track_id = item['track']['id']
						track_name = item['track']['name']
						album_name = item['track']['album']['name']
						album_artist = item['track']['album']['artists'][0]['name']
						album_image = item['track']['album']['images'][0]['url']
						played_at = item['played_at']
						writeSpotifyTracksSQL(user_id, track_id, track_name, album_name, album_artist, album_image, played_at)
					print(log_time_string() + "Fetched recently played tracks for user " + user_id + ".")
			except Exception as exception:
				print(log_time_string() + "aException: " + exception.args[0])
				# TODO: Fix this print entire exception

		time.sleep(kSpotifyFetchMinimumDelay)

def stravaDownloadThreadFunction():

	# time.sleep(kStravaFetchMinimumDelay)

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
		
		user_id = properties['user_id']
		access_token = properties['access_token']

		strava_request_params = stravaListAthleteActivitiesRequest()
		strava_request_headers = stravaTokenHeadersBearer(access_token)

		try:
			result = requests.get(kStravaListAthleteActivitiesURL, params=strava_request_params, headers=strava_request_headers).json()
			for activity in result:
				activity_id = str(activity['id'])
				activity_name = activity['name']
				activity_start_date_local = activity['start_date_local']
				activity_average_speed = str(activity['average_speed'])
				activity_type = str(activity['type'])
				writeStravaActivitiesSQL(user_id, activity_id, activity_name, activity_start_date_local, activity_average_speed, activity_type)
			print(log_time_string() + "Fetched latest activities for user " + user_id + ".")
		except Exception as exception:
			print(log_time_string() + "bException: " + exception.args[0])
			# TODO: Fix this print entire exception

		# time.sleep(kStravaFetchMinimumDelay)

def stravaDetailedActivityDownloadThreadFunction():

	while(True):
	
		# Connect to the database
		try:
			connection = sqlite3.connect(kDatabaseName)
			cursor = connection.cursor()
		except sqlite3.Error as error:
			print(log_time_string() + "Error: " + error.args[0])
			return False

		# Retrieve all rows from stravaActivities table
		rows = cursor.execute("SELECT * FROM stravaActivities").fetchall()
		names = [description[0] for description in cursor.description]

		for row in rows:
			
			properties = {}
			for value, column in zip(row, names):
				properties[column] = zlib.decompress(value)
			
			user_id = properties['user_id']
			activity_id = properties['activity_id']
			activity_name = properties['activity_name']

			detailedActivityPresent = isDetailedActivityPresentForActivity(activity_id)
			if (not detailedActivityPresent):
				strava_access_token = getStravaAccessTokenForUserID(user_id)
				strava_request_params = stravaGetActivityRequest(activity_id)
				strava_request_headers = stravaTokenHeadersBearer(strava_access_token)

				try:
					detailed_activity_json = requests.get(kStravaGetActivityRequestURL + "/" + activity_id,
						params=strava_request_params,
						headers=strava_request_headers).json()
					writeStravaDetailedActivitySQL(detailed_activity_json)
					print(log_time_string() + "Fetched detailed latest activitiy (" + activity_name.strip() + ") for user " + user_id + ".")
				except Exception as exception:
					print(log_time_string() + "cException: " + exception.args[0])
					# TODO: Fix this print entire exception

			time.sleep(kStravaDetailedActivityFetchMinimumDelay)
		connection.close()

def getStravaAccessTokenForUserID(user_id):

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		connection.close()
		return False

	# Extract access_token for the given user_id
	try:
		rows = cursor.execute("SELECT * FROM stravaCodes WHERE user_id = ?", (sqlite3.Binary(zlib.compress(user_id)),)).fetchall()
		names = [description[0] for description in cursor.description]

		for row in rows:			
			properties = {}
			for value, column in zip(row, names):
				properties[column] = zlib.decompress(value)
				
			access_token = properties['access_token']
			return access_token
	except Exception as exception:
		print(log_time_string() + "dException: " + str(exception))
		connection.close()
		return None

def isDetailedActivityPresentForActivity(activity_id):

	detailedActivityPresent = False

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		connection.close()
		return False

	# Check if activity_id is present in stravaDetailedActivities

	try:
		detailedActivityResult = cursor.execute("SELECT * FROM stravaDetailedActivities WHERE activity_id = ?", (activity_id,)).fetchall()
		if detailedActivityResult:
			detailedActivityPresent = True
	except Exception as exception:
		# TODO: Add known exception here
		if(exception.args[0].startswith('no such table')):
			noop()
		else:
			print(log_time_string() + "eException: " + str(exception))
	
	connection.close()
	return detailedActivityPresent

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
	# <meta http-equiv="refresh" content="10" >
	htmlOutput.append('<head><link href="https://unpkg.com/material-components-web@latest/dist/material-components-web.min.css" rel="stylesheet"><script src="https://unpkg.com/material-components-web@latest/dist/material-components-web.min.js"></script></head>')

	for tableName in tableNames:
		rows = cursor.execute("SELECT * FROM " + tableName).fetchall()
		names = [description[0] for description in cursor.description]

		htmlOutput.append("<h1 style='font-weight:700' class='mdc-list-group__subheader'>" + str(tableName) + " (" + str(len(rows)) + " rows)</h1>")
		htmlOutput.append('<div class="mdc-data-table">')
		htmlOutput.append('<div class="mdc-data-table__table-container">')
		htmlOutput.append('<table class="mdc-data-table__table" aria-label="Dessert calories">')
		htmlOutput.append("<tbody class='mdc-data-table__content'>")
		
		htmlOutput.append("<tr>")
		for name in names:
			htmlOutput.append('<th class="mdc-data-table__cell" scope="row">')
			htmlOutput.append(name)
			htmlOutput.append("</th>")
		htmlOutput.append("</tr>")

		for row in rows: 
			htmlOutput.append("<tr class='mdc-data-table__row'>")
			for cell in row:
				htmlOutput.append("<td class='mdc-data-table__cell'>")
				htmlOutput.append(zlib.decompress(cell))
				htmlOutput.append("</td>")
			htmlOutput.append("</tr>")
		htmlOutput.append("</tbody>")			
		htmlOutput.append("</table>")
		htmlOutput.append("</div>")
		htmlOutput.append("</div>")

	return "".join(htmlOutput)

def performanceView():
	
	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return "Error: " + error.args[0]

	# Retrieve all rows from stravaDetailedActivities table
	rows = cursor.execute("SELECT * FROM stravaDetailedActivities").fetchall()
	names = [description[0] for description in cursor.description]
	connection.close()

	html = []
	html.append('<html> \
	<head> \
		<link rel="stylesheet" type="text/css" href="/css/gallery.css"> \
		<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js" crossorigin="anonymous"></script> \
		<!-- <script type="text/javascript" src="gallery.js"></script> --> \
	</head> \
	<div class="gallery"> \
		<div class="box-container one-box-container"> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/DnvxveG5syhWV7QrUaI4LMaTYac0zMN-IxgUso8CN8I-768x576.jpg"> \
			</div> \
		</div> \
		<div class="box-container six-box-container"> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/qHeSJC8Q7tOoJx79wPHimZ8DRD2Tg8H7tbnL09eBJTE-768x576.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/2sHvOSl_D-AoPVteN33vTj7JUJoJfZ3HebQQATWVyu8-576x768.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/10PWyq1_mBpKIx5eiyJym3jfm6elEhpHQwk1IHZYjEg-576x768.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/NYFs5Ewdxozz9Gt-Mlwt5LF18SgV1exZ9VH2LRkY1uk-576x768.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/9xFzGYDvpoic4rwQIm8cJWLMGOCwXnWcrD2L4fqtPMg-576x768.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/Tp4T5RhCUv2_TGQGGFsO6iNYm5n9fx_dS_OCeuScUJM-768x576.jpg"> \
			</div> \
		</div> \
		<div class="box-container fiv-box-container"> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/2n7cZWNBVnqyOV63T5aXBPX162-4AycteEP8AksQcoQ-768x576.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/x6_dRvxzKc25vrSWg4Pw73FCs5pbWa0zweEGSHffP4s-576x768.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/OFHC4tb2TqaZXL5hOFRv8wt5eRGdLzyVAUJ0etfVvPw-768x576.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/adh39v4gqJrx3_7xxTBCf6rM0Dlr5abYUhgYg7TR7R0-768x576.jpg"> \
			</div> \
			<div class="image-container"> \
				<img src="https://dgtzuqphqg23d.cloudfront.net/vpQzfw44Um0-I0q6bNpCMlOcMl0n6IvImTcR2zVLgQg-576x768.jpg"> \
			</div> \
		</div> \
	</div> \
</html>')
	for row in rows:
		
		properties = {}
		for value, column in zip(row, names):
			properties[column] = zlib.decompress(value)
		
		# print(properties)

		# activity_id
		# activity_start_date_local
		# activity_type
		# activity_average_speed
		# activity_distance
		# activity_split_speeds
		# activity_split_hearts
		# activity_split_start_dates_local

		activity_id = properties['activity_id']
		activity_start_date_local = properties['activity_start_date_local'] # time.strptime(properties['last_update'], '%Y-%m-%d %H:%M:%S')
		activity_type = properties['activity_type']
		activity_average_speed = properties['activity_average_speed']
		activity_distance = properties['activity_distance']
		activity_split_speeds = properties['activity_split_speeds']
		activity_split_hearts = properties['activity_split_hearts']
		activity_split_start_dates_local = properties['activity_split_start_dates_local']

		if (activity_type == "Workout"):
			continue

		# Get readable activity time
		ui_time = time.strptime(activity_start_date_local, '%Y-%m-%dT%H:%M:%SZ')
		readable_time = time.strftime('%b %-d at %-H:%M', ui_time)

		# Get readable other things
		readable_activity_type = activity_type
		# print(readable_activity_type)
		
		# Get readable speed
		readable_speed = ""
		try:
			readable_speed = str(round(float(activity_average_speed), 2)) + "km/h" #todo
		except ValueError:
			noop()
		# print(readable_speed)
		# Get readable distance
		readable_distance_km = ""
		try:
			readable_distance_km = str(round(float(activity_distance)/1000, 2)) + "km"
		except ValueError:
			noop()
		# print(readable_distance_km)

		# Get readable pace
		readable_pace = []
		try:
			readable_pace = [str(float(x)) + "km/h" for x in activity_split_speeds.split(",")]
		except ValueError:
			noop()

		# Get readable hearts
		readable_hearts = []
		try:
			readable_hearts = [int(float(x)) for x in activity_split_hearts.split(",")]
		except ValueError:
			noop()
		# print(readable_hearts)

		# Get readable start times
		activity_split_starttimes = activity_split_start_dates_local
		activity_split_endtimes = []
		activity_split_songs = []
		try:
			activity_split_starttimes = [time.strptime(x, '%Y-%m-%dT%H:%M:%SZ') for x in activity_split_start_dates_local.split(",")]
			activity_split_endtimes = activity_split_starttimes[1:]
			activity_split_endtimes.append(activity_split_starttimes[-1])
		except:
			noop()

		# print(activity_split_starttimes, len(activity_split_starttimes))
		# print(activity_split_endtimes, len(activity_split_endtimes))


		# print(readable_activity_split_starttimes)
		# print(readable_activity_split_endtimes)

		song_in_interval = None
		for start_split_time, end_split_time in zip(activity_split_starttimes, activity_split_endtimes):
			song_in_interval = getSongBetween(start_split_time, end_split_time)
			if (song_in_interval):
				activity_split_songs.append(song_in_interval)
			else:
				activity_split_songs.append(("",""))
		
		

		html.append('<head><style> .html,body {background-color:#EAEAEA} .activity { background: #fff; border-radius: 2px; display: inline-block; margin: 1rem; position: relative; box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);//background-color: #F9F9F9; font-family: Helvetica; color: #333; padding: 15px; margin-bottom: 25px; float: left; display: block; position: relative; margin-left: 25px;}</style><link href="https://unpkg.com/material-components-web@latest/dist/material-components-web.min.css" rel="stylesheet"><script src="https://unpkg.com/material-components-web@latest/dist/material-components-web.min.js"></script></head>')

		html.append("<div class='activity'>")
		html.append("<h4 style='margin:0px;'>")
		html.append(activity_type + ", " + readable_time)
		html.append("</h4>")

		html.append("<table>")
		html.append("<tbody class='mdc-data-table__content'>")
		html.append("<tr>")
		html.append("<th>")
		html.append("Distance")
		html.append("</th>")
		html.append("<th>")
		html.append("Average speed")
		html.append("</th>")
		html.append("</tr>")
		
		html.append("<tr>")
		html.append("<td>")
		html.append(readable_distance_km)
		html.append("</td>")
		html.append("<td>")
		html.append(readable_speed)
		html.append("</td>")
		html.append("</tr>")
		html.append("</tbody")
		html.append("</table>")

		html.append("<table class='mdc-data-table__content'>")
		# html.append("<tbody )
		html.append("<tr>")
		html.append("<th>")
		html.append("Split")
		html.append("</th>")
		html.append("<th>")
		html.append("Pace")
		html.append("</th>")
		html.append("<th>")
		html.append("")
		html.append("</th>")
		html.append("<th>")
		html.append("Song")
		html.append("</th>")
		html.append("<th>")
		html.append("Heartrate")
		html.append("</th>")
		html.append("</tr>")

		split = 1
		for pace, song, heart in zip(readable_pace, activity_split_songs, readable_hearts):
			html.append("<tr>")
			html.append("<td>")
			html.append(str(split))
			html.append("</td>")
			html.append("<td>")
			html.append(str(pace))
			html.append("</td>")
			html.append("<td>")
			html.append("<img style='height: 25px; border-radius: 100%; float: right; margin-left: 20px; margin-right: 5px;' src='" + song[1] + "'>")
			html.append("</td>")
			html.append("<td>")
			html.append(song[0])
			html.append("</td>")
			html.append("<td>")
			html.append(str(heart))
			html.append("</td>")
			html.append("</tr>")
			split += 1

		# html.append("</tbody")
		html.append("</table>")
		html.append("</div>")

	return "\n".join(html)


def getSongBetween(start_time, end_time):
	readable_start_time = time.strftime('%b %-d: %-H:%M', start_time)
	readable_end_time = time.strftime('- %-H:%M', end_time)

	# Connect to the database
	try:
		connection = sqlite3.connect(kDatabaseName)
		cursor = connection.cursor()
	except sqlite3.Error as error:
		print(log_time_string() + "Error: " + error.args[0])
		return False

	# Retrieve all rows from spotifyCodes table
	rows = cursor.execute("SELECT * FROM spotifyTracks")
	names = [description[0] for description in cursor.description]
	for row in rows:
		properties = {}
		for value, column in zip(row, names):
			properties[column] = zlib.decompress(value)

		# Add 5 hours to convert to PDT
		played_at = properties['played_at']
		try:
			played_at = time.strptime(properties['played_at'], '%Y-%m-%dT%H:%M:%S.%fZ')
		except:
			played_at = time.strptime(properties['played_at'], '%Y-%m-%dT%H:%M:%SZ')
		played_at = datetime.datetime.fromtimestamp(mktime(played_at))
		played_at = played_at - datetime.timedelta(hours=7)
		played_at = played_at.timetuple()
		# print ("Original", played_at)
		# print ("Modified", played_at + relativedelta(hours=5))

		# if (False):
		if (start_time < played_at < end_time):
			# print(time.strftime('%b %-d: %-H:%M', start_time))
			# print(time.strftime('%b %-d: %-H:%M', played_at))
			# print(time.strftime('%b %-d: %-H:%M', end_time))
			track_name = properties['track_name']
			album_image = properties['album_image']
			connection.close()
			return (track_name, album_image)

	connection.close()
	return False

def noop():
    return None

def log_time_string():
	return time.strftime('Server    - - [%d/%b/%Y %H:%M:%S] ')