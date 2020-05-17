from globalParams import kStravaAuthorizeURL
from globalParams import kStravaRedirectURI
from globalParams import kStravaScope
from globalParams import kStravaClientID

from urllib import urlencode

def stravaAuthorizeRequest():
	query_prams_dict = {}
	query_prams_dict['client_id'] = kStravaClientID
	query_prams_dict['redirect_uri'] = kStravaRedirectURI
	query_prams_dict['response_type'] = "code"
	query_prams_dict['approval_prompt'] = "force"
	query_prams_dict['scope'] = ",".join(kStravaScope)
	return kStravaAuthorizeURL + "?" + urlencode(query_prams_dict)