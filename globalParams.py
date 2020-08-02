seconds = 1
minutes = 60
hours = 60 * 60
days = 60 * 60 * 24

kAuthorizationClientStaticFile = "AuthorizationClient.html"

kStravaAuthorizeURL = "https://www.strava.com/oauth/authorize"
kStravaTokenURL = "https://www.strava.com/oauth/token"
kStravaRedirectURI = "http://localhost:5000/stravaToken"
kStravaScope = ["read", "read_all", "profile:read_all", "profile:write", "activity:read", "activity:read_all", "activity:write"] # Minimize required stuff
kStravaClientID = "38171"

kSpotifyAuthorizeURL = "https://accounts.spotify.com/authorize"
kSpotifyTokenURL = "https://accounts.spotify.com/api/token"
kSpotifyRecentlyPlayedURL = "https://api.spotify.com/v1/me/player/recently-played"
kSpotifyRedirectURI = "http://localhost:5000/spotifyToken"
kSpotifyScope = "user-read-playback-state, user-read-recently-played"
kSpotifyClientID = "8bff943da02b4f409395f371441b3990"

kFetchingDelay = 1 * seconds
kExceptionTolerance = 100
kRefreshTokensMinimumDelay = 10 * seconds
kSpotifyFetchMinimumDelay = 10 * minutes