import requests
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
from authorizationRequests import stravaTokenRequest
from authorizationRequests import spotifyTokenRequest

from authorizationRequests import stravaTokenHeaders
from authorizationRequests import spotifyTokenHeaders

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
from controllerMethods import createUserFromStrava

app = Flask(__name__)
app.secret_key = kAppSecretKey

connnection = sqlite3.connect(kDatabaseName)
cursor = connnection.cursor()

@app.route('/status')
def status():
	print session
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
		strava_token_params = stravaTokenRequest(code)
		result = requests.post(kStravaTokenURL, strava_token_params).json()

		session['strava_code'] = code
		session['strava_scope'] = scope

		session['strava_access_token'] = result["access_token"]
		session['strava_refresh_token'] = result["refresh_token"]
		session['strava_athlete'] = result["athlete"]

		return redirect("/")
		# create account for user
		# retrieve the access, refresh tokens
		# send to home with success
		# if tokens missing, send to home with failure


# Spotify /Token
@app.route('/spotifyToken')
def spotifyToken():
	print("here")
	code = request.args.get('code')
	error = request.args.get('error')

	if (error):
		# redirect to home with unauthorized - error
		return "Error occurred: " + error
	elif (not code):
		# redirect to home with unauthorized - no code
		return "Error occurred: no authorization code"
	else:
		spotify_token_params = spotifyTokenRequest(code)
		spotify_token_headers_dict = spotifyTokenHeaders()
		print("params: " + str(spotify_token_params))
		print("headers: " + str(spotify_token_headers_dict))
		result = requests.post(kSpotifyTokenURL, data=spotify_token_params, headers=spotify_token_headers_dict).json()
		print(result)

		# Add the relevant stuff to session

		return redirect("/")

# Start / Restart server
@app.route(kStartEnginePath)
def restartServer():
	engineStatus = startEngine()
	return engineStatus