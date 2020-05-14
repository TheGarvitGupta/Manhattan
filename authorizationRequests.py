from globalParams import kStravaAuthorizeURL
from globalParams import kStravaRedirectURI
from globalParams import kStravaScope
from globalParams import kStravaClientID

from urllib import urlencode

def stravaAuthorizeRequest():
	client_id = kStravaClientID
	redirect_uri = kStravaRedirectURI
	response_type = "code"
	approval_prompt = "force"
	scope = ",".join(kStravaScope)
	
	query_prams_dict = {}
	query_prams_dict['client_id'] = client_id
	query_prams_dict['redirect_uri'] = redirect_uri
	query_prams_dict['response_type'] = response_type
	query_prams_dict['approval_prompt'] = approval_prompt
	query_prams_dict['scope'] = scope

	return kStravaAuthorizeURL + "?" + urlencode(query_prams_dict)