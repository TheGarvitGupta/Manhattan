import requests

from globalParams import kAuthorizationClientStaticFile
from globalParams import kStravaAuthorizeURL
from globalParams import kStravaTokenURL
from globalParams import kStravaRedirectURI
from globalParams import kStravaScope
from globalParams import kStravaClientID

from authorizationRequests import stravaAuthorizeRequest
from authorizationRequests import stravaTokenRequest

from flask import Flask
from flask import send_from_directory
from flask import redirect
from flask import request

app = Flask(__name__)

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

# Return from Strava /Authorize make request to Strava /Token
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

	if (error):		
		# Redirect to home with `error`
		return "Error occurred"

	if (sorted(scope.split(",")) != sorted(kStravaScope)):
		# Redirect to home with failure
		return "Scopes mismatch"

	if (not code):
		# Redirect to home with no code failure
		return "No code"

	else:
		# initiate strava token exchange
		strava_token_params = stravaTokenRequest(code)
		result = requests.post(kStravaTokenURL, strava_token_params)
		

		print ("TokenReceiveD", result.text)
		

		return result.text
		# invoke stravaTokenRequest to return url and post params
		# make the post request
		# retrieve the access, refresh tokens
		# send to home with success
		# if tokens missing, send to home with failure