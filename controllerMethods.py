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

def createUserSQL(username, user_id, profile_picture, city, state, country, firstname, lastname):
	# Crewate table if not there
	# insert the user

def writeStravaCodesSQL(user_id, strava_access_token, strava_refresh_token):
	# create strava tokens table if not there

def writeSpotifyCodesSQL(user_id, spotify_access_token, spotify_refresh_token):
	# create spotify tokens table if not there

def createUserFromSession(session):
	# user table
	username = session['strava_athlete']['username']
	user_id = session['strava_athlete']['id']
	profile_picture = session['strava_athlete']['profile']
	city = session['strava_athlete']['city']
	state = session['strava_athlete']['state']
	country = session['strava_athlete']['country']
	firstname = session['strava_athlete']['firstname']
	lastname = session['strava_athlete']['lastname']
	createUserSQL(username, user_id, profile_picture, city, state, country, firstname, lastname)
	
	# strava access table
	strava_access_token = session['strava_access_token']
	strava_refresh_token = session['strava_refresh_token']
	writeStravaCodesSQL(user_id, strava_access_token, strava_refresh_token)

	# spotify access table
	spotify_access_token = session['spotify_access_token']
	spotify_refresh_token = session['spotify_refresh_token']
	writeSpotifyCodesSQL(user_id, spotify_access_token, spotify_refresh_token):
