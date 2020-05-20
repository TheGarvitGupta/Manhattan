kAuthorizationClientStaticFile = "AuthorizationClient.html"

kStravaAuthorizeURL = "https://www.strava.com/oauth/authorize"
kStravaTokenURL = "https://www.strava.com/oauth/token"
kStravaRedirectURI = "http://localhost:5000/stravaToken"
kStravaScope = ["read", "read_all", "profile:read_all", "profile:write", "activity:read", "activity:read_all", "activity:write"] # Minimize required stuff
kStravaClientID = "38171"

kSpotifyAuthorizeURL = "https://accounts.spotify.com/authorize"
kSpotifyTokenURL = "https://accounts.spotify.com/api/token"
kSpotifyRedirectURI = "http://localhost:5000/spotifyToken"
kSpotifyScope = "ugc-image-upload, user-read-playback-state, streaming, user-library-modify" #this needs to be populated
kSpotifyClientID = "8bff943da02b4f409395f371441b3990"