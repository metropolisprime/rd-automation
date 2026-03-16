## RD Automator

### Why does this exist?

I didn't need the full -ARR stack, and I wanted something that was pretty dead simple that I could hook up to Seerr and make manual requests to or sync my Plex watchlist.

Since I already have Zurg setup, this essentially takes a request (whether from the watchlist or a manual request), looks for a cached version and then automatically adds it to my RD account.

This whole setup assumes the following:
- You have Seerr setup
- You have RD setup and communicating with your Plex or Jellyfin or whatever instance the way you like it
- You have a way to either send Seerr requests OR you have logged into Seerr via Plex so you're automatically tracking your watchlist
- You have at least some familiarity with the command line and Docker

### Prereqs
- **Docker** installed
- Seerr running already, setup, in a Docker container
- A `.env` file in this folder (copy `.env.example` → `.env` and fill in values)

#### Environment Variables Setup
The `.env` file requires the following variables:

- `RD_TOKEN`: Your RD API token. Get this from your [Real Debrid account settings](https://real-debrid.com/apitoken).
- `TMDB_API_KEY`: Your TMDB (The Movie Database) API key. Sign up at [TMDB](https://www.themoviedb.org/settings/api) to get an API key.
- `SEARCH_PROVIDER_BASE_URL`: Base URL for the search provider (default: `https://torrentio.strem.fun/`)
- `MOVIE_LIMIT_GB`: Maximum size limit for movie downloads in gigabytes (default: 15)
- `EP_LIMIT_GB`: Maximum size limit for episode downloads in gigabytes (default: 7)

### Setup Instructions

#### 1) Create Docker Network
Create a shared Docker network to allow communication between RD Automation and Seerr containers:

```bash
docker network create seerr-rd-net
```

If Seerr is already running, connect it to the network (this command is safe to run multiple times):

```bash
docker network connect seerr-rd-net seerr
```

#### 2) Build the Docker Image
Build the RD Automation container image:

```bash
docker build --no-cache -t rd-automation .
```

#### 3) Run the Container
Stop and remove any existing container, then start a fresh one:

```bash
# Stop and remove existing container (ignore errors if it doesn't exist)
docker stop rd-auto || true
docker rm rd-auto || true

# Run the container
docker run -d \
  --name rd-auto \
  --network seerr-rd-net \
  -p 3000:3000 \
  --env-file .env \
  -v "$(pwd):/app" \
  rd-automation
```

**Note:** The `-v "$(pwd):/app"` mount uses your current directory. On Windows, this resolves to the full Windows path.

#### 4) Verify Setup
Test that the container is running and accessible:

```bash
# Check container status
docker ps | grep rd-auto

# Test the API endpoint
curl http://localhost:3000/health
```

### Seerr Integration

#### Webhook Configuration
In Seerr, create a webhook with the following JSON payload template:

```json
{
  "tmdbId": "{{media_tmdbid}}",
  "mediaType": "{{media_type}}",
  "seasonNumber": "{{season_number}}",
  "episodeNumber": "{{episode_number}}",
  "{{extra}}": []
}
```

- `tmdbId`: The TMDB ID of the movie/show
- `mediaType`: Either "movie" or "tv"
- `seasonNumber`: Season number (for TV shows only)
- `episodeNumber`: Episode number (for TV shows only)
- `{{extra}}`: Additional metadata (leave as empty array)

#### Webhook URL
Set the webhook URL to: `http://rd-auto:3000/request`

Since both containers are on the same Docker network, Seerr can reach RD Automation using the container name `rd-auto` as the hostname.

Since we named the container `rd-auto` in the steps above, we are now allowed to communicate directly with the container using the `rd-auto` hostname. This webhook should be sent to `http://rd-auto:3000/request`

I have this webhook firing on Request Approved on my end. You may need to do manual setup for auto approval on Plex Watchlist sync. The Seerr docs are very clear on how this can be done.

### Rebuilding After Code Changes

When you modify the code, rebuild and restart the container:

```bash
# Build new image
docker build --no-cache -t rd-automation .

# Stop and remove old container
docker stop rd-auto || true
docker rm rd-auto || true

# Start updated container
docker run -d \
  --name rd-auto \
  --network seerr-rd-net \
  -p 3000:3000 \
  --env-file .env \
  -v "$(pwd):/app" \
  rd-automation
```
