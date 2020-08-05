import requests
import threading
import json
import sqlite3
import pprint

from globalParams import kAuthorizationClientStaticFile

from globalParams import kStravaTokenURL
from globalParams import kStravaRedirectURI
from globalParams import kStravaScope
from globalParams import kStravaClientID

from globalParams import kSpotifyTokenURL
from globalParams import kSpotifyRedirectURI
from globalParams import kSpotifyScope
from globalParams import kSpotifyClientID

from authorizationRequests import stravaAuthorizeRequest
from authorizationRequests import spotifyAuthorizeRequest

from authorizationRequests import stravaTokenRequestWithAuthorizationCode
from authorizationRequests import stravaTokenRequestWithRefreshToken

from authorizationRequests import spotifyTokenRequestWithAuthorizationCode
from authorizationRequests import spotifyTokenRequestWithRefreshToken

from authorizationRequests import stravaTokenHeaders
from authorizationRequests import spotifyTokenHeadersBasic

from privateParams import kAppSecretKey
from privateParams import kDatabaseName
from privateParams import kStartEnginePath

from flask import Flask
from flask import send_from_directory
from flask import redirect
from flask import request
from flask import session

from controllerMethods import applicationStatistics
from controllerMethods import startEngine
from controllerMethods import createUserFromSession
from controllerMethods import databaseView
from controllerMethods import refreshTokensThreadFunction
from controllerMethods import spotifyDownloadThreadFunction
from controllerMethods import stravaDownloadThreadFunction
from controllerMethods import stravaDetailedActivityDownloadThreadFunction

app = Flask(__name__)
app.secret_key = kAppSecretKey

connection = sqlite3.connect(kDatabaseName)
cursor = connection.cursor()

# Start refresh token thread
# refresh_token_thread = threading.Thread(target=refreshTokensThreadFunction, args=())
# refresh_token_thread.start()

# Start Spotify download thread
# spotify_download_thread = threading.Thread(target=spotifyDownloadThreadFunction, args=())
# spotify_download_thread.start()

# Start Strava download thread
# strava_download_thread = threading.Thread(target=stravaDownloadThreadFunction, args=())
# strava_download_thread.start()

# Start Strava detailed activity download thread
strava_detailed_activity_download_thread = threading.Thread(target=stravaDetailedActivityDownloadThreadFunction, args=())
strava_detailed_activity_download_thread.start()

@app.route('/status')
def status():
	sessionString = {}
	for key in session:
		sessionString[key] = session[key]
	return sessionString

@app.route('/')
def home():
	# TODO: generate this page dynamically
    return send_from_directory('html', kAuthorizationClientStaticFile)

@app.route('/javascript/<path:path>')
def javascript(path):
    return send_from_directory('javascript', path)

@app.route('/css/<path:path>')
def css(path):
    return send_from_directory('css', path)

# Strava /Authorize
@app.route('/linkStrava')
def stravaAuthorize():
	strava_authorize_url = stravaAuthorizeRequest()
	return redirect(strava_authorize_url)

# Spotify /Authorize
@app.route('/linkSpotify')
def spotifyAuthorize():
	spotify_authorize_url = spotifyAuthorizeRequest()
	return redirect(spotify_authorize_url)

# Strava /Token
@app.route('/stravaToken')
def stravaToken():
	# extract stuff and make more requetss
	# Failure: http://localhost:5000/stravaToken?state=&error=access_denied
	# Success: http://localhost:5000/stravaToken?state=&code=2d3ff3385d76327cd42f3e34f8de37a49189c6c1&scope=read
	state = request.args.get('state')
	error = request.args.get('error')
	code = request.args.get('code')
	scope = request.args.get('scope')

	status = {}

	if (error):		
		# Redirect to home with `error`
		return "Error occurred: " + error

	elif (sorted(scope.split(",")) != sorted(kStravaScope)):
		# Redirect to home with failure
		return "Error occurred: scopes mismatch"

	elif (not code):
		# Redirect to home with no code failure
		return "Error occurred: no authorization code"

	else:
		# initiate strava token exchange
		strava_token_params = stravaTokenRequestWithAuthorizationCode(code)
		result = requests.post(kStravaTokenURL, strava_token_params).json()

		session['strava_access_token'] = result["access_token"]
		session['strava_refresh_token'] = result["refresh_token"]
		session['strava_athlete'] = result["athlete"]
		session['strava_access_token_validity'] = result['expires_in']

		return redirect("/")
		# create account for user
		# retrieve the access, refresh tokens
		# send to home with success
		# if tokens missing, send to home with failure


# Spotify /Token
@app.route('/spotifyToken')
def spotifyToken():
	code = request.args.get('code')
	error = request.args.get('error')

	if (error):
		# redirect to home with unauthorized - error
		return "Error occurred: " + error
	elif (not code):
		# redirect to home with unauthorized - no code
		return "Error occurred: no authorization code"
	else:
		spotify_token_params = spotifyTokenRequestWithAuthorizationCode(code)
		spotify_token_headers_dict = spotifyTokenHeadersBasic()
		result = requests.post(kSpotifyTokenURL, data=spotify_token_params, headers=spotify_token_headers_dict).json()

		session['spotify_access_token'] = result['access_token']
		session['spotify_refresh_token'] = result['refresh_token']
		session['spotify_access_token_validity'] = result['expires_in']

		return redirect("/")


# Create user action
@app.route('/createUser')
def createUser():
	createUserFromSession(session)
	return "X"

# View database
@app.route('/database')
def viewDatabase():
	return databaseView()

# # Strava Web Hook
# @app.route('/stravaWebHook')
# def stravaWebHook():
# 	VERIFY_TOKEN = "STRAVA"

# 	mode = request.args.get('hub.mode')
# 	token = request.args.get('hub.verify_token')
# 	challenge = request.args.get('hub.challenge')

# 	if (mode && token):
#     	if (mode == 'subscribe' && token == VERIFY_TOKEN):
#     		print("Strava webhook received")
#       		print(mode)
#       		print(token)
#       		print(challenge)
#       	else:
#       		print("respond with 403")


# Start / Restart server
@app.route(kStartEnginePath)
def restartServer():
	engineStatus = startEngine()
	return engineStatus