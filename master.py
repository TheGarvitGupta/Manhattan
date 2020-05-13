import requests

from urllib import urlencode

from flask import Flask
from flask import send_from_directory
from flask import redirect
app = Flask(__name__)

kAuthorizationClientStaticFile = "AuthorizationClient.html"
kStravaAuthorizeURL = "https://www.strava.com/oauth/authorize"
kStravaRedirectURI = "http://localhost/stravaToken"
kStravaClientID = "38171"


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

@app.route('/stravaToken')
def stravaToken():
	# extract stuff and make more requetss
	return this

def stravaAuthorizeRequest():
	client_id = kStravaClientID
	redirect_uri = kStravaRedirectURI
	response_type = "code"
	approval_prompt = "force"
	scope = "read,read_allprofile:read_all,profile:write,activity:read,activity:read_all,activity:write"
	query_prams_dict = {'client_id': client_id, 'redirect_uri': redirect_uri, 'response_type': response_type, 'approval_prompt': approval_prompt, 'scope': scope}

	return kStravaAuthorizeURL + "?" + urlencode(query_prams_dict)