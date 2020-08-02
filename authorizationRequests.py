from globalParams import kStravaAuthorizeURL
from globalParams import kStravaRedirectURI
from globalParams import kStravaScope
from globalParams import kStravaClientID
from globalParams import kSpotifyAuthorizeURL
from globalParams import kSpotifyRedirectURI
from globalParams import kSpotifyScope
from globalParams import kSpotifyClientID

from privateParams import kStravaClientSecret
from privateParams import kSpotifyClientSecret

from urllib import urlencode
import base64

def stravaAuthorizeRequest():
	query_prams_dict = {}
	query_prams_dict['client_id'] = kStravaClientID
	query_prams_dict['redirect_uri'] = kStravaRedirectURI
	query_prams_dict['response_type'] = "code"
	query_prams_dict['approval_prompt'] = "force"
	query_prams_dict['scope'] = ",".join(kStravaScope)
	return kStravaAuthorizeURL + "?" + urlencode(query_prams_dict)

def stravaTokenRequestWithAuthorizationCode(authorization_code):
	query_prams_dict = {}
	query_prams_dict['client_id'] = kStravaClientID
	query_prams_dict['client_secret'] = kStravaClientSecret
	query_prams_dict['code'] = authorization_code
	query_prams_dict['grant_type'] = "authorization_code"
	return query_prams_dict

def stravaTokenRequestWithRefreshToken(refresh_token):
	query_prams_dict = {}
	query_prams_dict['client_id'] = kStravaClientID
	query_prams_dict['client_secret'] = kStravaClientSecret
	query_prams_dict['refresh_token'] = refresh_token
	query_prams_dict['grant_type'] = "refresh_token"
	return query_prams_dict

def spotifyAuthorizeRequest():
	query_prams_dict = {}
	query_prams_dict['client_id'] = kSpotifyClientID
	query_prams_dict['redirect_uri'] = kSpotifyRedirectURI
	query_prams_dict['response_type'] = "code"
	query_prams_dict['scope'] = kSpotifyScope
	return kSpotifyAuthorizeURL + "?" + urlencode(query_prams_dict)

def spotifyTokenRequestWithAuthorizationCode(authorization_code):
	query_prams_dict = {}
	query_prams_dict['client_id'] = kSpotifyClientID
	query_prams_dict['grant_type'] = "authorization_code"
	query_prams_dict['code'] = authorization_code
	query_prams_dict['redirect_uri'] = kSpotifyRedirectURI
	return query_prams_dict

def spotifyTokenRequestWithRefreshToken(refresh_token):
	query_prams_dict = {}
	# query_prams_dict['client_id'] = kSpotifyClientID
	query_prams_dict['grant_type'] = "refresh_token"
	query_prams_dict['refresh_token'] = refresh_token
	# query_prams_dict['redirect_uri'] = kSpotifyRedirectURI
	return query_prams_dict

def spotifyRecentlyPlayedRequest():
	query_prams_dict = {}
	query_prams_dict['limit'] = "50"
	return query_prams_dict

def stravaTokenHeaders():
	return None

def spotifyTokenHeadersBasic():
	headers = {}
	headers["Authorization"] = "Basic " + base64.b64encode("" + kSpotifyClientID + ":" + kSpotifyClientSecret, altchars=None)
	return headers

def spotifyTokenHeadersBearer(access_token):
	headers = {}
	headers["Authorization"] = "Bearer " + access_token
	return headers