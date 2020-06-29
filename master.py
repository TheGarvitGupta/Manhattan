# Brian was here

import requests
import json
import sqlite3

from globalParams import kAuthorizationClientStaticFile
from globalParams import kStravaAuthorizeURL
from globalParams import kStravaTokenURL
from globalParams import kStravaRedirectURI
from globalParams import kStravaScope
from globalParams import kStravaClientID

from authorizationRequests import stravaAuthorizeRequest
from authorizationRequests import spotifyAuthorizeRequest
from authorizationRequests import stravaTokenRequest
from authorizationRequests import spotifyTokenRequest

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
	status = {}
	status["strava"] = False
	status["spotify"] = False

	print(session)
	if "isStravaAuthenticated" in session:
		if session["isStravaAuthenticated"]:
			status["strava"] = True
	if "isSpotifyAuthenticated" in session:
		if session["isSpotifyAuthenticated"]:
			status["spotify"] = True
	return json.dumps(status)

@app.route('/')
def home():
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

	print(scope.split(","))
	print(sorted(scope.split(",")))

	status = {}

	if (error):		
		# Redirect to home with `error`
		return "Error occurred"

	elif (sorted(scope.split(",")) != sorted(kStravaScope)):
		# Redirect to home with failure
		return "Scopes mismatch"

	elif (not code):
		# Redirect to home with no code failure
		return "No code"

	else:
		# initiate strava token exchange
		session['isStravaAuthenticated'] = True
		print(session)
		strava_token_params = stravaTokenRequest(code)
		result = requests.post(kStravaTokenURL, strava_token_params)
		createUserFromStrava(result)
		return result.text
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
		return error + ""
	elif (not code):
		# redirect to home with unauthorized - no code
		return "No code"
	else:
		session['isSpotifyAuthenticated'] = True
		return "Success"

# Start / Restart server
@app.route(kStartEnginePath)
def restartServer():
	engineStatus = startEngine()
	return engineStatus